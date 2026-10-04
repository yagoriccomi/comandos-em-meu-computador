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
const { parseSpokenPin } = require('../domain/pinParser');
const { sendCommand, DeliveryResult } = require('../messaging/commandBus');

const PENDING_ATTRIBUTE = 'pendingAction';
const PENDING_CHOICE_ATTRIBUTE = 'pendingChoice';
const PENDING_PIN_ATTRIBUTE = 'pendingPin';
const PENDING_CHAT_ATTRIBUTE = 'pendingChat';
const ChatChoice = Object.freeze({ CONTINUE: 'continuar', NEW: 'novo' });
const CONTINUE_WORDS = /\b(continu\w*|anterior|mesmo|antigo|velho)\b/;
const NEW_WORDS = /\b(nov[oa]|comec\w*|zero|outro|outra)\b/;
const MAX_PIN_REPROMPTS = 2;
const CLAUDE_ANSWER_ACTION_ID = 'resposta_claude';
const PENDING_CONFIRMATION_TTL_MS = 60 * 1000;
const YES_INTENT = 'AMAZON.YesIntent';
const NO_INTENT = 'AMAZON.NoIntent';
/** Durante a pergunta "qual deles?", estes intents NÃO são resposta (cancelar, parar, ajuda). */
const NOT_A_CHOICE_INTENTS = Object.freeze(['AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.HelpIntent', 'AMAZON.NavigateHomeIntent', NO_INTENT]);

function hashUserId(userId) {
    return crypto.createHash('sha256').update(String(userId)).digest('hex');
}

/** Voice ID: personId só existe quando a Alexa reconhece a voz (recurso "personalização" ligado na skill). */
function getPersonId(requestEnvelope) {
    const system = requestEnvelope.context && requestEnvelope.context.System;
    return system && system.person ? system.person.personId : undefined;
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
        const isProject = action.choiceParam === 'projeto';
        if (choices.length === 0) return speak(handlerInput, isProject ? speech.PROJECT_NOT_FOUND : speech.PROGRAM_NOT_FOUND);
        storePending(handlerInput, PENDING_CHOICE_ATTRIBUTE, { actionId: action.id, params, choices, expiresAt: clock() + PENDING_CONFIRMATION_TTL_MS });
        return ask(handlerInput, result === DeliveryResult.AMBIGUOUS ? speech.whichOne(choices) : speech.didYouMean(choices, isProject ? 'projeto' : 'programa'));
    }

    /**
     * Trava de voz das ações "voiceLocked" (Claude Code). Com hashes cadastrados, só essas vozes passam.
     * Sem cadastro, vale só o PIN do PC; a Lambda registra o HASH da voz vista para o dono poder cadastrar.
     */
    function isVoiceAllowed(handlerInput, secrets, action) {
        if (!action.voiceLocked) return true;
        const personId = getPersonId(handlerInput.requestEnvelope);
        const allowed = secrets.allowedPersonIdHashes || [];
        if (allowed.length === 0) {
            if (personId) logger.info({ event: 'person_seen', personHash: hashUserId(personId) });
            return true;
        }
        return Boolean(personId) && allowed.includes(hashUserId(personId));
    }

    /** O PC pediu o PIN (sessão de 3 h vencida ou PIN errado): guarda a ordem SEM o PIN e pergunta. */
    function askPin(handlerInput, action, params, wasWrong, reprompts = 0) {
        const { pin, ...withoutPin } = params;
        storePending(handlerInput, PENDING_PIN_ATTRIBUTE, { actionId: action.id, params: withoutPin, reprompts, expiresAt: clock() + PENDING_CONFIRMATION_TTL_MS });
        return ask(handlerInput, wasWrong ? speech.PIN_WRONG : speech.ASK_PIN);
    }

    function answerDone(handlerInput, action, text) {
        if (text) return speak(handlerInput, speech.pcText(text));
        return speak(handlerInput, speech.DONE_BY_ACTION[action.id] || speech.DONE);
    }

    async function execute(handlerInput, secrets, action, params) {
        if (!isVoiceAllowed(handlerInput, secrets, action)) {
            logger.info({ event: 'request_rejected', actionId: action.id, reason: 'voice_not_allowed' });
            return speak(handlerInput, speech.VOICE_NOT_RECOGNIZED);
        }
        const transport = await connectTransport(secrets.mqtt);
        try {
            const { result, requestId, choices, text } = await sendCommand({ transport, secrets, actionId: action.id, params });
            // Só códigos no log: nunca o nome falado, o texto da pesquisa, o PIN, as opções ou a resposta do Claude.
            logger.info({ event: 'action_result', actionId: action.id, requestId, result });
            if (result === DeliveryResult.DONE) return answerDone(handlerInput, action, text);
            if (action.id === CLAUDE_ANSWER_ACTION_ID) {
                if (result === DeliveryResult.PENDING) return speak(handlerInput, speech.CLAUDE_STILL_THINKING);
                if (result === DeliveryResult.NOT_FOUND) return speak(handlerInput, speech.CLAUDE_NO_ANSWER);
            }
            if (result === DeliveryResult.PIN_REQUIRED) return askPin(handlerInput, action, params, params.pin !== undefined);
            if (result === DeliveryResult.LOCKED) return speak(handlerInput, speech.CLAUDE_CODE_LOCKED);
            if (result === DeliveryResult.CHAT_CHOICE) {
                const { pin, ...withoutPin } = params;
                storePending(handlerInput, PENDING_CHAT_ATTRIBUTE, { actionId: action.id, params: withoutPin, reprompts: 0, expiresAt: clock() + PENDING_CONFIRMATION_TTL_MS });
                return ask(handlerInput, speech.ASK_CHAT_CHOICE);
            }
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
            && (hasPendingAction(handlerInput) || hasPending(handlerInput, PENDING_CHOICE_ATTRIBUTE) || hasPending(handlerInput, PENDING_PIN_ATTRIBUTE)),
        handle(handlerInput) {
            takePendingAction(handlerInput, clock);
            takePending(handlerInput, PENDING_CHOICE_ATTRIBUTE, clock);
            takePending(handlerInput, PENDING_PIN_ATTRIBUTE, clock);
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
            // Programa escolhido vai com "exato"; outras escolhas (ex.: projeto do Claude Code) vão no parâmetro da ação.
            const choiceParam = action.choiceParam || 'programa';
            const choice = choiceParam === 'programa' ? { programa: chosen, exato: 1 } : { [choiceParam]: chosen };
            const resolution = revalidateParams(action, { ...pending.params, ...choice });
            if (!resolution.ok) {
                logger.info({ event: 'request_rejected', reason: resolution.reason });
                return speak(handlerInput, speech.UNKNOWN_ACTION);
            }
            return execute(handlerInput, secrets, resolution.action, resolution.params);
        },
    };

    /** Resposta ao pedido de PIN: dígitos falados um a um ("zero, meia, três…"); 4 a 8 dígitos. */
    const pinHandler = {
        canHandle(handlerInput) {
            const { requestEnvelope } = handlerInput;
            return Alexa.getRequestType(requestEnvelope) === 'IntentRequest'
                && hasPending(handlerInput, PENDING_PIN_ATTRIBUTE)
                && !NOT_A_CHOICE_INTENTS.includes(Alexa.getIntentName(requestEnvelope));
        },
        async handle(handlerInput) {
            const secrets = await authorize(handlerInput);
            if (!secrets) return speak(handlerInput, speech.FAILED);
            const pending = takePending(handlerInput, PENDING_PIN_ATTRIBUTE, clock);
            const action = pending && catalog.findById(pending.actionId);
            if (!action) return speak(handlerInput, speech.CONFIRMATION_EXPIRED);
            const digits = parseSpokenPin(spokenSlotValue(handlerInput.requestEnvelope));
            if (!digits) {
                const reprompts = Number(pending.reprompts) || 0;
                if (reprompts >= MAX_PIN_REPROMPTS) return speak(handlerInput, speech.CANCELLED_BY_USER);
                storePending(handlerInput, PENDING_PIN_ATTRIBUTE, { ...pending, reprompts: reprompts + 1 });
                return ask(handlerInput, speech.PIN_NOT_UNDERSTOOD);
            }
            const resolution = revalidateParams(action, { ...pending.params, pin: digits });
            if (!resolution.ok) {
                logger.info({ event: 'request_rejected', reason: resolution.reason });
                return speak(handlerInput, speech.UNKNOWN_ACTION);
            }
            return execute(handlerInput, secrets, resolution.action, resolution.params);
        },
    };

    /** "Continuar o chat anterior ou começar um novo?": sim/continuar → anterior; não/novo → novo. */
    const chatChoiceHandler = {
        canHandle(handlerInput) {
            const { requestEnvelope } = handlerInput;
            if (Alexa.getRequestType(requestEnvelope) !== 'IntentRequest' || !hasPending(handlerInput, PENDING_CHAT_ATTRIBUTE)) return false;
            const intentName = Alexa.getIntentName(requestEnvelope);
            return intentName === NO_INTENT || !NOT_A_CHOICE_INTENTS.includes(intentName);
        },
        async handle(handlerInput) {
            const secrets = await authorize(handlerInput);
            if (!secrets) return speak(handlerInput, speech.FAILED);
            const pending = takePending(handlerInput, PENDING_CHAT_ATTRIBUTE, clock);
            const action = pending && catalog.findById(pending.actionId);
            if (!action) return speak(handlerInput, speech.CONFIRMATION_EXPIRED);
            const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
            const spoken = String(spokenSlotValue(handlerInput.requestEnvelope) || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
            let chat;
            if (intentName === YES_INTENT || CONTINUE_WORDS.test(spoken)) chat = ChatChoice.CONTINUE;
            else if (intentName === NO_INTENT || NEW_WORDS.test(spoken)) chat = ChatChoice.NEW;
            if (!chat) {
                const reprompts = Number(pending.reprompts) || 0;
                if (reprompts >= MAX_PIN_REPROMPTS) return speak(handlerInput, speech.CANCELLED_BY_USER);
                storePending(handlerInput, PENDING_CHAT_ATTRIBUTE, { ...pending, reprompts: reprompts + 1 });
                return ask(handlerInput, speech.CHAT_CHOICE_NOT_UNDERSTOOD);
            }
            const resolution = revalidateParams(action, { ...pending.params, chat });
            if (!resolution.ok) {
                logger.info({ event: 'request_rejected', reason: resolution.reason });
                return speak(handlerInput, speech.UNKNOWN_ACTION);
            }
            return execute(handlerInput, secrets, resolution.action, resolution.params);
        },
    };

    return [chatChoiceHandler, pinHandler, choiceHandler, actionHandler, confirmYesHandler, confirmNoHandler];
}

module.exports = { createActionHandlers, hashUserId, PENDING_ATTRIBUTE, PENDING_CHOICE_ATTRIBUTE, PENDING_PIN_ATTRIBUTE, PENDING_CONFIRMATION_TTL_MS };
