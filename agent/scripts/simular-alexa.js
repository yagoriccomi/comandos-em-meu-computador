'use strict';
/*
 * Faz o papel da Lambda para testar o caminho real (HiveMQ → agente → ack) sem publicar a skill.
 * Uso: npm run simular -- <actionId> [minutos] [--segredos=C:\caminho\secrets.json]
 * Por padrão lê %ProgramData%\OMonstro\enviar-para-alexa\secrets.json, gerado pelo instalador.
 */
const fs = require('fs');
const path = require('path');
const paths = require('../src/config/paths');
const { publicCatalog } = require('../src/shared');
const { validateSecrets } = require('../../lambda/config/secretsLoader');
const { connectMqttTransport } = require('../../lambda/messaging/mqttTransport');
const { sendCommand, DeliveryResult } = require('../../lambda/messaging/commandBus');

const SECRETS_ARG = '--segredos=';
const SPOKEN_RESULT = Object.freeze({
    [DeliveryResult.DONE]: 'Feito.',
    [DeliveryResult.FAILED]: 'Não consegui executar essa ação. (o agente recusou ou a ação falhou — veja o log local)',
    [DeliveryResult.NO_ANSWER]: 'Não consegui executar essa ação. (o agente não respondeu em 5 s)',
});

function parseArgs(argv) {
    const secretsArg = argv.find((arg) => arg.startsWith(SECRETS_ARG));
    const [actionId, paramValue] = argv.filter((arg) => !arg.startsWith('--'));
    return {
        actionId,
        paramValue,
        secretsFile: secretsArg ? secretsArg.slice(SECRETS_ARG.length) : path.join(paths.ALEXA_EXPORT_DIR, 'secrets.json'),
    };
}

async function main() {
    const { actionId, paramValue, secretsFile } = parseArgs(process.argv.slice(2));
    const action = publicCatalog.findById(actionId);
    if (!action) {
        console.error(`Ação desconhecida. Disponíveis: ${publicCatalog.actions.map((a) => a.id).join(', ')}`);
        process.exitCode = 1;
        return;
    }
    const params = {};
    for (const param of action.params) {
        params[param.name] = Number.parseInt(paramValue, 10);
    }
    const secrets = validateSecrets(JSON.parse(fs.readFileSync(secretsFile, 'utf8')));
    if (action.requiresConfirmation) console.log(`(a Alexa perguntaria antes: confirma ${action.spokenName}?)`);

    const started = Date.now();
    const transport = await connectMqttTransport(secrets.mqtt);
    try {
        const { result, requestId } = await sendCommand({ transport, secrets, actionId, params });
        console.log(`Alexa: ${SPOKEN_RESULT[result]}`);
        console.log(`requestId=${requestId} tempo=${Date.now() - started} ms`);
    } finally {
        await transport.close();
    }
}

main().catch((error) => {
    console.error(`Falha na simulação: ${error.code || error.message}`);
    process.exitCode = 1;
});
