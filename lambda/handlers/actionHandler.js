'use strict';
/* Intents que disparam ações do catálogo: resolve, confirma (se sensível), envia e fala o resultado. */
const crypto = require('crypto');
const Alexa = require('ask-sdk-core');
const speech = require('../speech');
const { resolveIntent, ResolutionFailure, isActionIntent } = require('../domain/actionResolver');
const { sendCommand, DeliveryResult } = require('../messaging/commandBus');

const ConfirmationStatus = Object.freeze({ NONE: 'NONE', CONFIRMED: 'CONFIRMED', DENIED: 'DENIED' });

function hashUserId(userId) {
    return crypto.createHash('sha256').update(String(userId)).digest('hex');
}

function getSkillId(requestEnvelope) {
    const system = requestEnvelope.context && requestEnvelope.context.System;
    return system && system.application ? system.application.applicationId : undefined;
}

function isAuthorized(requestEnvelope, secrets) {
    if (getSkillId(requestEnvelope) !== secrets.skillId) return false;
    if (secrets.allowedUserIdHashes.length === 0) return true;
    return secrets.allowedUserIdHashes.includes(hashUserId(Alexa.getUserId(requestEnvelope)));
}

function speak(handlerInput, text) {
    return handlerInput.responseBuilder.speak(text).withShouldEndSession(true).getResponse();
}

function answerResolutionFailure(handlerInput, resolution, intent) {
    if (resolution.reason === ResolutionFailure.MISSING_PARAM) {
        const param = resolution.action.params.find((candidate) => candidate.slot === resolution.missingSlot);
        const question = speech.askForParam(param);
        return handlerInput.responseBuilder.speak(question).reprompt(question)
            .addElicitSlotDirective(resolution.missingSlot, intent).getResponse();
    }
    if (resolution.reason === ResolutionFailure.INVALID_PARAM) {
        return speak(handlerInput, speech.invalidParam(resolution.param));
    }
    return speak(handlerInput, speech.UNKNOWN_ACTION);
}

/**
 * @param {object} deps
 * @param {object} deps.catalog
 * @param {() => Promise<object>} deps.loadSecrets
 * @param {(mqttConfig: object) => Promise<object>} deps.connectTransport
 * @param {{ info: Function }} deps.logger
 */
function createActionHandler({ catalog, loadSecrets, connectTransport, logger }) {
    return {
        canHandle(handlerInput) {
            const { requestEnvelope } = handlerInput;
            if (Alexa.getRequestType(requestEnvelope) !== 'IntentRequest') return false;
            const intentName = Alexa.getIntentName(requestEnvelope);
            return isActionIntent(intentName) || Boolean(catalog.findByIntent(intentName));
        },

        async handle(handlerInput) {
            const { requestEnvelope } = handlerInput;
            const secrets = await loadSecrets();
            if (!isAuthorized(requestEnvelope, secrets)) {
                logger.info({ event: 'request_rejected', reason: 'not_authorized' });
                return speak(handlerInput, speech.FAILED);
            }

            const intent = requestEnvelope.request.intent;
            const resolution = resolveIntent(intent, catalog);
            if (!resolution.ok) {
                logger.info({ event: 'request_rejected', reason: resolution.reason });
                return answerResolutionFailure(handlerInput, resolution, intent);
            }

            const { action, params } = resolution;
            if (action.requiresConfirmation) {
                if (intent.confirmationStatus === ConfirmationStatus.DENIED) {
                    return speak(handlerInput, speech.CANCELLED_BY_USER);
                }
                if (intent.confirmationStatus !== ConfirmationStatus.CONFIRMED) {
                    const question = speech.confirmAction(action, params);
                    return handlerInput.responseBuilder.speak(question).reprompt(question)
                        .addConfirmIntentDirective(intent).getResponse();
                }
            }

            const transport = await connectTransport(secrets.mqtt);
            try {
                const { result, requestId } = await sendCommand({ transport, secrets, actionId: action.id, params });
                logger.info({ event: 'action_result', actionId: action.id, requestId, result });
                return speak(handlerInput, result === DeliveryResult.DONE ? speech.DONE : speech.FAILED);
            } finally {
                await transport.close().catch(() => {});
            }
        },
    };
}

module.exports = { createActionHandler, hashUserId };
