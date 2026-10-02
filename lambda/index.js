'use strict';
/* Ponto de entrada da skill: só monta as dependências e a cadeia de handlers. */
const Alexa = require('ask-sdk-core');
const { catalog } = require('./domain/catalog');
const { createSecretsLoader, createS3ObjectReader } = require('./config/secretsLoader');
const { connectMqttTransport } = require('./messaging/mqttTransport');
const { createActionHandlers } = require('./handlers/actionHandler');
const builtIn = require('./handlers/builtInHandlers');

const USER_AGENT = 'o-monstro/1.0';

/** Log estruturado de uma linha. Só recebe campos sem dados pessoais (actionId, requestId, códigos). */
const logger = Object.freeze({
    info: (fields) => console.log(JSON.stringify({ level: 'info', ...fields })),
    error: (fields) => console.error(JSON.stringify({ level: 'error', ...fields })),
});

function createSkill({ loadSecrets, connectTransport, log = logger }) {
    return Alexa.SkillBuilders.custom()
        .addRequestHandlers(
            builtIn.LaunchRequestHandler,
            ...createActionHandlers({ catalog, loadSecrets, connectTransport, logger: log }),
            builtIn.HelpIntentHandler,
            builtIn.CancelAndStopIntentHandler,
            builtIn.SessionEndedRequestHandler,
            builtIn.UnknownIntentHandler)
        .addErrorHandlers(builtIn.createErrorHandler(log))
        .withCustomUserAgent(USER_AGENT);
}

let productionSkill;

exports.createSkill = createSkill;
// Handler assíncrono (sem callback): compatível com os runtimes Node atuais da Lambda.
exports.handler = async (event, context) => {
    if (!productionSkill) {
        const loadSecrets = createSecretsLoader({
            readObject: createS3ObjectReader(),
            bucket: process.env.S3_PERSISTENCE_BUCKET,
        });
        productionSkill = createSkill({ loadSecrets, connectTransport: connectMqttTransport }).create();
    }
    return productionSkill.invoke(event, context);
};
