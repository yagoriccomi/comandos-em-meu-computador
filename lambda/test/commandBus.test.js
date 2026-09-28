'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../protocol/message');
const { sendCommand, DeliveryResult } = require('../messaging/commandBus');
const { createMemoryBroker } = require('./support/memoryBroker');

const SECRETS = { deviceId: 'pc-teste-1234', hmacSecret: 's'.repeat(43) };
const SHORT_TIMEOUT_MS = 50;

/** Agente falso: responde a todo cmd válido com o status pedido. */
async function startFakeAgent(broker, { status, secret = SECRETS.hmacSecret, requestIdOverride } = {}) {
    const agent = broker.connect();
    await agent.subscribe(protocol.commandTopic(SECRETS.deviceId), async (raw) => {
        const command = protocol.verify(protocol.parse(raw), { secret: SECRETS.hmacSecret, expectedType: protocol.MessageType.COMMAND });
        const ack = protocol.createAck({ requestId: requestIdOverride || command.requestId, status }, secret);
        await agent.publish(protocol.ackTopic(SECRETS.deviceId), protocol.serialize(ack));
    });
}

test('shouldReturnDoneWhenAgentAcksOk', async () => {
    const broker = createMemoryBroker();
    await startFakeAgent(broker, { status: 'ok' });
    const { result } = await sendCommand({ transport: broker.connect(), secrets: SECRETS, actionId: 'abrir_netflix' });
    assert.equal(result, DeliveryResult.DONE);
});

test('shouldReturnFailedWhenAgentAcksError', async () => {
    const broker = createMemoryBroker();
    await startFakeAgent(broker, { status: 'error' });
    const { result } = await sendCommand({ transport: broker.connect(), secrets: SECRETS, actionId: 'abrir_netflix' });
    assert.equal(result, DeliveryResult.FAILED);
});

test('shouldReturnNoAnswerWhenNobodyListens', async () => {
    const broker = createMemoryBroker();
    const { result } = await sendCommand({ transport: broker.connect(), secrets: SECRETS, actionId: 'abrir_netflix', timeoutMs: SHORT_TIMEOUT_MS });
    assert.equal(result, DeliveryResult.NO_ANSWER);
});

test('shouldIgnoreAckSignedWithWrongSecret', async () => {
    const broker = createMemoryBroker();
    await startFakeAgent(broker, { status: 'ok', secret: 'z'.repeat(43) });
    const { result } = await sendCommand({ transport: broker.connect(), secrets: SECRETS, actionId: 'abrir_netflix', timeoutMs: SHORT_TIMEOUT_MS });
    assert.equal(result, DeliveryResult.NO_ANSWER);
});

test('shouldIgnoreAckForAnotherRequest', async () => {
    const broker = createMemoryBroker();
    await startFakeAgent(broker, { status: 'ok', requestIdOverride: '11111111-1111-4111-8111-111111111111' });
    const { result } = await sendCommand({ transport: broker.connect(), secrets: SECRETS, actionId: 'abrir_netflix', timeoutMs: SHORT_TIMEOUT_MS });
    assert.equal(result, DeliveryResult.NO_ANSWER);
});

test('shouldPublishOnlyProtocolFieldsWithoutPersonalData', async () => {
    const broker = createMemoryBroker();
    await sendCommand({ transport: broker.connect(), secrets: SECRETS, actionId: 'desligar_em_minutos', params: { minutos: 30 }, timeoutMs: SHORT_TIMEOUT_MS });
    const [{ topic, payload }] = broker.published;
    assert.equal(topic, 'omonstro/pc-teste-1234/cmd');
    assert.deepEqual(Object.keys(JSON.parse(payload)).sort(), ['actionId', 'params', 'requestId', 'sig', 'ts', 'type', 'v']);
});
