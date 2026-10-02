'use strict';
/*
 * Intents que disparam ações do catálogo: resolve, confirma (se sensível), envia e fala o resultado.
 *
 * Confirmação: a ação sensível fica guardada na SESSÃO (com validade curta) e a skill pergunta mantendo o
 * microfone aberto; o "sim"/"não" chega como AMAZON.YesIntent/NoIntent. Não usamos Dialog.ConfirmIntent
 * porque, sem modelo de diálogo, a Alexa encerrava a sessão e o "sim" do usuário nunca chegava à skill.
 */
const crypto = require('crypto');
const Alexa = require('ask-sdk-core');
const speech = require('../speech');
const { resolveIntent, resolvePendingAction, ResolutionFailure, isActionIntent } = require('../domain/actionResolver');
const { sendCommand, DeliveryResult } = require('../messaging/commandBus');

const PENDING_ATTRIBUTE = 'pendingAction';
const PENDING_CONFIRMATION_TTL_MS = 60 * 1000;
const YES_INTENT = 'AMAZON.YesIntent';
const NO_INTENT = 'AMAZON.NoIntent';

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

function isIntentRequest(handlerInput, ...intentNames) {
    const { requestEnvelope } = handlerInput;
    return Alexa.getRequestType(requestEnvelope) === 'IntentRequest'
        && intentNames.includes(Alexa.getIntentName(requestEnvelope));
}

function speak(handlerInput, text) {
    return handlerInput.responseBuilder.speak(text).withShouldEndSession(true).getResponse();
}

/** Pergunta e mantém a sessão aberta para ouvir a resposta. */
function ask(handlerInput, question) {
    return handlerInput.responseBuilder.speak(question).reprompt(question).withShouldEndSession(false).getResponse();
}

function takePendingAction(handlerInput, clock) {
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const pending = attributes[PENDING_ATTRIBUTE];
    delete attributes[PENDING_ATTRIBUTE];
    handlerInput.attributesManager.setSessionAttributes(attributes);
    if (!pending || !Number.isSafeInteger(pending.expiresAt) || pending.expiresAt < clock()) return undefined;
    return pending;
}

function hasPendingAction(handlerInput) {
    return Boolean(handlerInput.attributesManager.getSessionAttributes()[PENDING_ATTRIBUTE]);
}

function answerResolutionFailure(handlerInput, resolution) {
    if (resolution.reason === ResolutionFailure.MISSING_PARAM) {
        const param = resolution.action.params.find((candidate) => candidate.slot === resolution.missingSlot);
        return ask(handlerInput, speech.askForParam(param));
    }
    if (resolution.reason === ResolutionFailure.INVALID_PARAM && resolution.param) {
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
 * @param {() => number} [deps.clock]
 * @returns {object[]} handlers: ação, "sim" e "não"
 */
function createActionHandlers({ catalog, loadSecrets, connectTransport, logger, clock = Date.now }) {
    async function authorize(handlerInput) {
        const secrets = await loadSecrets();
        if (isAuthorized(handlerInput.requestEnvelope, secrets)) return secrets;
        logger.info({ event: 'request_rejected', reason: 'not_authorized' });
        return undefined;
    }

    async function execute(handlerInput, secrets, action, params) {
        const transport = await connectTransport(secrets.mqtt);
        try {
            const { result, requestId } = await sendCommand({ transport, secrets, actionId: action.id, params });
            logger.info({ event: 'action_result', actionId: action.id, requestId, result });
            return speak(handlerInput, result === DeliveryResult.DONE ? speech.DONE : speech.FAILED);
        } finally {
            await transport.close().catch(() => {});
        }
    }

    const actionHandler = {
        canHandle(handlerInput) {
            const { requestEnvelope } = handlerInput;
            if (Alexa.getRequestType(requestEnvelope) !== 'IntentRequest') return false;
            const intentName = Alexa.getIntentName(requestEnvelope);
            return isActionIntent(intentName) || Boolean(catalog.findByIntent(intentName));
        },

        async handle(handlerInput) {
            const secrets = await authorize(handlerInput);
            if (!secrets) return speak(handlerInput, speech.FAILED);

            // Um novo pedido substitui qualquer confirmação que tenha ficado pendente.
            takePendingAction(handlerInput, clock);
            const resolution = resolveIntent(handlerInput.requestEnvelope.request.intent, catalog);
            if (!resolution.ok) {
                logger.info({ event: 'request_rejected', reason: resolution.reason });
                return answerResolutionFailure(handlerInput, resolution);
            }

            const { action, params } = resolution;
            if (!action.requiresConfirmation) return execute(handlerInput, secrets, action, params);

            const attributes = handlerInput.attributesManager.getSessionAttributes();
            attributes[PENDING_ATTRIBUTE] = { actionId: action.id, params, expiresAt: clock() + PENDING_CONFIRMATION_TTL_MS };
            handlerInput.attributesManager.setSessionAttributes(attributes);
            return ask(handlerInput, speech.confirmAction(action, params));
        },
    };

    const confirmYesHandler = {
        canHandle: (handlerInput) => isIntentRequest(handlerInput, YES_INTENT) && hasPendingAction(handlerInput),
        async handle(handlerInput) {
            const secrets = await authorize(handlerInput);
            if (!secrets) return speak(handlerInput, speech.FAILED);
            const pending = takePendingAction(handlerInput, clock);
            if (!pending) {
                logger.info({ event: 'request_rejected', reason: 'confirmation_expired' });
                return speak(handlerInput, speech.CONFIRMATION_EXPIRED);
            }
            const resolution = resolvePendingAction(pending, catalog);
            if (!resolution.ok) {
                logger.info({ event: 'request_rejected', reason: resolution.reason });
                return speak(handlerInput, speech.UNKNOWN_ACTION);
            }
            return execute(handlerInput, secrets, resolution.action, resolution.params);
        },
    };

    const confirmNoHandler = {
        canHandle: (handlerInput) => isIntentRequest(handlerInput, NO_INTENT) && hasPendingAction(handlerInput),
        handle(handlerInput) {
            takePendingAction(handlerInput, clock);
            return speak(handlerInput, speech.CANCELLED_BY_USER);
        },
    };

    return [actionHandler, confirmYesHandler, confirmNoHandler];
}

module.exports = { createActionHandlers, hashUserId, PENDING_ATTRIBUTE, PENDING_CONFIRMATION_TTL_MS };
