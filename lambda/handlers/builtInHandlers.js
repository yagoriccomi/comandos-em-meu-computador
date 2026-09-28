'use strict';
/* Handlers padrão da Alexa (abrir, ajuda, sair, não entendi, fim de sessão, erro global). */
const Alexa = require('ask-sdk-core');
const speech = require('../speech');

function isIntent(handlerInput, ...intentNames) {
    const { requestEnvelope } = handlerInput;
    return Alexa.getRequestType(requestEnvelope) === 'IntentRequest'
        && intentNames.includes(Alexa.getIntentName(requestEnvelope));
}

const LaunchRequestHandler = {
    canHandle: (handlerInput) => Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest',
    handle: (handlerInput) => handlerInput.responseBuilder.speak(speech.WELCOME).reprompt(speech.WELCOME_REPROMPT).getResponse(),
};

const HelpIntentHandler = {
    canHandle: (handlerInput) => isIntent(handlerInput, 'AMAZON.HelpIntent'),
    handle: (handlerInput) => handlerInput.responseBuilder.speak(speech.HELP).reprompt(speech.HELP).getResponse(),
};

const CancelAndStopIntentHandler = {
    canHandle: (handlerInput) => isIntent(handlerInput, 'AMAZON.CancelIntent', 'AMAZON.StopIntent', 'AMAZON.NavigateHomeIntent'),
    handle: (handlerInput) => handlerInput.responseBuilder.speak(speech.GOODBYE).withShouldEndSession(true).getResponse(),
};

/** Qualquer intent não tratado (inclusive FallbackIntent) é uma ação desconhecida — nunca ecoa o que foi dito. */
const UnknownIntentHandler = {
    canHandle: (handlerInput) => Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest',
    handle: (handlerInput) => handlerInput.responseBuilder.speak(speech.UNKNOWN_ACTION).withShouldEndSession(true).getResponse(),
};

const SessionEndedRequestHandler = {
    canHandle: (handlerInput) => Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest',
    // Não logar o envelope: contém userId, deviceId e apiAccessToken (LGPD).
    handle: (handlerInput) => handlerInput.responseBuilder.getResponse(),
};

function createErrorHandler(logger) {
    return {
        canHandle: () => true,
        handle(handlerInput, error) {
            logger.error({ event: 'unhandled_error', errorName: error && error.name, errorCode: error && error.code });
            return handlerInput.responseBuilder.speak(speech.FAILED).withShouldEndSession(true).getResponse();
        },
    };
}

module.exports = {
    LaunchRequestHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    UnknownIntentHandler,
    SessionEndedRequestHandler,
    createErrorHandler,
};
