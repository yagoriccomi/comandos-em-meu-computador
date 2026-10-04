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
const { resolveIntent, resolvePendingAction, revalidateParams, ResolutionFailure, isActionIntent } = require('../domain/actionResolver');
const { pickChoice } = require('../domain/choiceResolver');
const { sendCommand, DeliveryResult } = require('../messaging/commandBus');

const PENDING_ATTRIBUTE = 'pendingAction';
const PENDING_CHOICE_ATTRIBUTE = 'pendingChoice';
const PENDING_CONFIRMATION_TTL_MS = 60 * 1000;
const YES_INTENT = 'AMAZON.YesIntent';
const NO_INTENT = 'AMAZON.NoIntent';
/** Durante a pergunta "qual deles?", estes intents NÃO são resposta (cancelar, parar, ajuda). */
const NOT_A_CHOICE_INTENTS = Object.freeze(['AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.HelpIntent', 'AMAZON.NavigateHomeIntent', NO_INTENT]);

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

function takePending(handlerInput, attributeName, clock) {
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    const pending = attributes[attributeName];
    delete attributes[attributeName];
    handlerInput.attributesManager.setSessionAttributes(attributes);
    if (!pending || !Number.isSafeInteger(pending.expiresAt) || pending.expiresAt < clock()) return undefined;
    return pending;
}

function takePendingAction(handlerInput, clock) {
    return takePending(handlerInput, PENDING_ATTRIBUTE, clock);
}

function storePending(handlerInput, attributeName, value) {
    const attributes = handlerInput.attributesManager.getSessionAttributes();
    attributes[attributeName] = value;
    handlerInput.attributesManager.setSessionAttributes(attributes);
}

function hasPending(handlerInput, attributeName) {
    return Boolean(handlerInput.attributesManager.getSessionAttributes()[attributeName]);
}

function hasPendingAction(handlerInput) {
    return hasPending(handlerInput, PENDING_ATTRIBUTE);
}

/** Primeiro valor falado em qualquer slot do intent (a resposta à pergunta "qual deles?"). */
function spokenSlotValue(requestEnvelope) {
    const slots = (requestEnvelope.request.intent && requestEnvelope.request.intent.slots) || {};
    const filled = Object.values(slots).find((slot) => slot && typeof slot.value === 'string' && slot.value.trim());
    return filled ? filled.value : undefined;
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

    /** O PC achou vários parecidos (ou só parecidos): guarda as opções e pergunta qual. */
    function askWhichOne(handlerInput, action, params, result, choices) {
        if (choices.length === 0) return speak(handlerInput, speech.PROGRAM_NOT_FOUND);
        storePending(handlerInput, PENDING_CHOICE_ATTRIBUTE, { actionId: action.id, params, choices, expiresAt: clock() + PENDING_CONFIRMATION_TTL_MS });
        return ask(handlerInput, result === DeliveryResult.AMBIGUOUS ? speech.whichOne(choices) : speech.didYouMean(choices));
    }

    async function execute(handlerInput, secrets, action, params) {
        const transport = await connectTransport(secrets.mqtt);
        try {
            const { result, requestId, choices } = await sendCommand({ transport, secrets, actionId: action.id, params });
            // Só códigos no log: nunca o nome falado, o texto da pesquisa ou as opções.
            logger.info({ event: 'action_result', actionId: action.id, requestId, result });
            if (result === DeliveryResult.DONE) return speak(handlerInput, speech.DONE);
            if (result === DeliveryResult.AMBIGUOUS || result === DeliveryResult.NOT_FOUND) {
                return askWhichOne(handlerInput, action, params, result, choices);
            }
            return speak(handlerInput, speech.FAILED);
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
        canHandle: (handlerInput) => isIntentRequest(handlerInput, NO_INTENT)
            && (hasPendingAction(handlerInput) || hasPending(handlerInput, PENDING_CHOICE_ATTRIBUTE)),
        handle(handlerInput) {
            takePendingAction(handlerInput, clock);
            takePending(handlerInput, PENDING_CHOICE_ATTRIBUTE, clock);
            return speak(handlerInput, speech.CANCELLED_BY_USER);
        },
    };

    /** Resposta a "Encontrei X e Y. Qual deles?": "o segundo", o nome, ou "sim" quando havia uma só opção. */
    const choiceHandler = {
        canHandle(handlerInput) {
            const { requestEnvelope } = handlerInput;
            return Alexa.getRequestType(requestEnvelope) === 'IntentRequest'
                && hasPending(handlerInput, PENDING_CHOICE_ATTRIBUTE)
                && !NOT_A_CHOICE_INTENTS.includes(Alexa.getIntentName(requestEnvelope));
        },
        async handle(handlerInput) {
            const secrets = await authorize(handlerInput);
            if (!secrets) return speak(handlerInput, speech.FAILED);
            const pending = takePending(handlerInput, PENDING_CHOICE_ATTRIBUTE, clock);
            if (!pending || !Array.isArray(pending.choices)) return speak(handlerInput, speech.CONFIRMATION_EXPIRED);
            const isYes = Alexa.getIntentName(handlerInput.requestEnvelope) === YES_INTENT;
            const chosen = isYes && pending.choices.length === 1
                ? pending.choices[0]
                : pickChoice(pending.choices, spokenSlotValue(handlerInput.requestEnvelope));
            const action = catalog.findById(pending.actionId);
            if (!chosen || !action) return speak(handlerInput, speech.CHOICE_NOT_UNDERSTOOD);
            const resolution = revalidateParams(action, { ...pending.params, programa: chosen, exato: 1 });
            if (!resolution.ok) {
                logger.info({ event: 'request_rejected', reason: resolution.reason });
                return speak(handlerInput, speech.UNKNOWN_ACTION);
            }
            return execute(handlerInput, secrets, resolution.action, resolution.params);
        },
    };

    return [choiceHandler, actionHandler, confirmYesHandler, confirmNoHandler];
}

module.exports = { createActionHandlers, hashUserId, PENDING_ATTRIBUTE, PENDING_CHOICE_ATTRIBUTE, PENDING_CONFIRMATION_TTL_MS };
