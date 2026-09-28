'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../protocol/message');
const { createSkill } = require('../index');
const { hashUserId } = require('../handlers/actionHandler');
const { createMemoryBroker } = require('./support/memoryBroker');

const SKILL_ID = 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555';
const USER_ID = 'amzn1.ask.account.TESTE';
const SECRETS = Object.freeze({
    skillId: SKILL_ID,
    deviceId: 'pc-teste-1234',
    hmacSecret: 'k'.repeat(43),
    mqtt: { url: 'mqtts://broker.test:8883', username: 'u', password: 'p' },
    allowedUserIdHashes: [],
});

function envelope(request, { skillId = SKILL_ID } = {}) {
    return {
        version: '1.0',
        session: { new: true, sessionId: 'sessao', application: { applicationId: skillId }, user: { userId: USER_ID } },
        context: { System: { application: { applicationId: skillId }, user: { userId: USER_ID }, device: { deviceId: 'eco' } } },
        request: { requestId: 'req', timestamp: new Date().toISOString(), locale: 'pt-BR', ...request },
    };
}

function intentRequest(name, slots = {}, confirmationStatus = 'NONE') {
    return envelope({ type: 'IntentRequest', dialogState: 'STARTED', intent: { name, confirmationStatus, slots } });
}

function matchedSlot(name, value, id) {
    return { [name]: { name, value, confirmationStatus: 'NONE', resolutions: { resolutionsPerAuthority: [
        { authority: 'a', status: { code: 'ER_SUCCESS_MATCH' }, values: [{ value: { name: value, id } }] },
    ] } } };
}

/** Monta a skill com broker em memória e um agente falso que responde `agentStatus` (ou não responde). */
async function buildSkill({ secrets = SECRETS, agentStatus } = {}) {
    const broker = createMemoryBroker();
    const executed = [];
    const logs = [];
    if (agentStatus) {
        const agent = broker.connect();
        await agent.subscribe(protocol.commandTopic(secrets.deviceId), async (raw) => {
            const command = protocol.verify(protocol.parse(raw), { secret: secrets.hmacSecret, expectedType: protocol.MessageType.COMMAND });
            executed.push({ actionId: command.actionId, params: command.params });
            const ack = protocol.createAck({ requestId: command.requestId, status: agentStatus }, secrets.hmacSecret);
            await agent.publish(protocol.ackTopic(secrets.deviceId), protocol.serialize(ack));
        });
    }
    const log = { info: (fields) => logs.push(fields), error: (fields) => logs.push(fields) };
    const skill = createSkill({
        loadSecrets: async () => secrets,
        connectTransport: async () => broker.connect(),
        log,
    }).create();
    return { skill, executed, logs, broker };
}

function speechOf(response) {
    return response.response.outputSpeech.ssml.replace(/<\/?speak>/g, '');
}

test('shouldSayDoneWhenAgentExecutesApp', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(speechOf(response), 'Feito.');
    assert.deepEqual(executed, [{ actionId: 'abrir_netflix', params: {} }]);
});

test('shouldSayCouldNotWhenAgentReportsError', async () => {
    const { skill } = await buildSkill({ agentStatus: 'error' });
    const response = await skill.invoke(intentRequest('ExecutarRotinaIntent', matchedSlot('rotina', 'bloquear a tela', 'bloquear_tela')));
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
});

test('shouldSayUnknownAndSendNothingForUnmatchedSlot', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const slots = { aplicativo: { name: 'aplicativo', value: 'powershell', resolutions: { resolutionsPerAuthority: [
        { authority: 'a', status: { code: 'ER_SUCCESS_NO_MATCH' } }] } } };
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', slots));
    assert.equal(speechOf(response), 'Não conheço essa ação.');
    assert.equal(broker.published.length, 0);
});

test('shouldAskConfirmationBeforeSensitiveAction', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('DesligarEmMinutosIntent', { minutos: { name: 'minutos', value: '30' } }));
    assert.equal(speechOf(response), 'Você confirma desligar o computador em 30 minutos?');
    assert.equal(response.response.directives[0].type, 'Dialog.ConfirmIntent');
    assert.equal(broker.published.length, 0);
});

test('shouldExecuteSensitiveActionAfterConfirmation', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('DesligarEmMinutosIntent', { minutos: { name: 'minutos', value: '30' } }, 'CONFIRMED'));
    assert.equal(speechOf(response), 'Feito.');
    assert.deepEqual(executed, [{ actionId: 'desligar_em_minutos', params: { minutos: 30 } }]);
});

test('shouldDoNothingWhenUserDeniesConfirmation', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('ExecutarRotinaIntent', matchedSlot('rotina', 'reiniciar', 'reiniciar_pc'), 'DENIED'));
    assert.equal(speechOf(response), 'Tudo bem, não fiz nada.');
    assert.equal(broker.published.length, 0);
});

test('shouldAskForMinutesWhenMissing', async () => {
    const { skill } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('DesligarEmMinutosIntent', { minutos: { name: 'minutos' } }));
    assert.equal(response.response.directives[0].type, 'Dialog.ElicitSlot');
    assert.equal(response.response.directives[0].slotToElicit, 'minutos');
});

test('shouldRefuseMinutesOutOfRange', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('DesligarEmMinutosIntent', { minutos: { name: 'minutos', value: '500' } }, 'CONFIRMED'));
    assert.equal(speechOf(response), 'O valor precisa ser de 1 a 240 minutos.');
    assert.equal(broker.published.length, 0);
});

test('shouldSayCouldNotWhenAgentDoesNotAnswer', async () => {
    const { skill } = await buildSkill();
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
});

test('shouldRejectRequestFromAnotherSkill', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const request = envelope({ type: 'IntentRequest', intent: { name: 'AbrirAplicativoIntent', confirmationStatus: 'NONE',
        slots: matchedSlot('aplicativo', 'netflix', 'abrir_netflix') } }, { skillId: 'amzn1.ask.skill.outra' });
    const response = await skill.invoke(request);
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
    assert.equal(broker.published.length, 0);
});

test('shouldRejectUserOutsideAllowListWhenConfigured', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok', secrets: { ...SECRETS, allowedUserIdHashes: ['0'.repeat(64)] } });
    await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(broker.published.length, 0);
});

test('shouldAcceptUserInsideAllowList', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok', secrets: { ...SECRETS, allowedUserIdHashes: [hashUserId(USER_ID)] } });
    await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(executed.length, 1);
});

test('shouldAnswerGenericallyWhenSecretsFail', async () => {
    const logs = [];
    const skill = createSkill({
        loadSecrets: async () => { throw Object.assign(new Error('boom'), { code: 'invalid_hmac_secret' }); },
        connectTransport: async () => { throw new Error('não deveria conectar'); },
        log: { info: (f) => logs.push(f), error: (f) => logs.push(f) },
    }).create();
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
    assert.equal(logs[0].errorCode, 'invalid_hmac_secret');
});

test('shouldNeverLogPersonalData', async () => {
    const { skill, logs } = await buildSkill({ agentStatus: 'ok' });
    await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    await skill.invoke(envelope({ type: 'SessionEndedRequest', reason: 'USER_INITIATED' }));
    const serialized = JSON.stringify(logs);
    assert.ok(!serialized.includes(USER_ID));
    assert.ok(!serialized.includes('eco'));
    assert.deepEqual(Object.keys(logs[0]).sort(), ['actionId', 'event', 'requestId', 'result']);
});

test('shouldNotEchoUnknownIntentName', async () => {
    const { skill } = await buildSkill();
    const response = await skill.invoke(intentRequest('AMAZON.FallbackIntent'));
    assert.equal(speechOf(response), 'Não conheço essa ação.');
});
