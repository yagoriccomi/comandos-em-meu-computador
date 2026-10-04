'use strict';
/* Integração ponta a ponta sem rede: commandBus da skill ↔ broker em memória ↔ núcleo do agente. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { protocol, publicCatalog } = require('../src/shared');
const { sendCommand, DeliveryResult } = require('../../lambda/messaging/commandBus');
const { createMemoryBroker } = require('../../lambda/test/support/memoryBroker');
const { buildLocalActions } = require('../src/config/localActions');
const { createActionExecutor } = require('../src/executor/actionExecutor');
const { createCommandGuard } = require('../src/security/commandGuard');
const { createAgentCore } = require('../src/core/agentCore');

const CONFIG = { deviceId: 'pc-teste-1234', hmacSecret: 'm'.repeat(43) };
const SHORT_TIMEOUT_MS = 100;

const localActions = buildLocalActions({ actions: [
    { id: 'desligar_em_minutos', executable: 'C:\\Windows\\System32\\shutdown.exe', args: ['/s', '/t', '{minutos*60}'], enabled: true },
    { id: 'cancelar_desligamento', executable: 'C:\\Windows\\System32\\shutdown.exe', args: ['/a'], enabled: true },
    { id: 'abrir_netflix', executable: 'C:\\Windows\\explorer.exe', args: ['https://www.netflix.com'], enabled: true },
    { id: 'reiniciar_pc', enabled: false },
    { id: 'abrir_programa', interno: true, enabled: true },
    { id: 'resposta_claude', interno: true, enabled: true },
] }, publicCatalog, { checkFileExists: false });

async function startAgent({ paused = false, desktopResult = { ok: true } } = {}) {
    const broker = createMemoryBroker();
    const executed = [];
    const desktopCalls = [];
    const logs = [];
    const logger = { info: (e) => logs.push(e), warn: (e) => logs.push(e), error: (e) => logs.push(e) };
    const execFile = (file, args, options, callback) => {
        executed.push({ file, args });
        setImmediate(() => callback(null, '', ''));
    };
    const core = createAgentCore({
        config: CONFIG,
        transport: broker.connect(),
        guard: createCommandGuard({ secret: CONFIG.hmacSecret }),
        localActions,
        executor: createActionExecutor({ execFile, logger }),
        desktopBridge: { execute: async (actionId, params) => { desktopCalls.push({ actionId, params }); return desktopResult; } },
        pauseState: { isPaused: () => paused },
        logger,
    });
    await core.start();
    const alexa = (actionId, params) => sendCommand({ transport: broker.connect(), secrets: CONFIG, actionId, params, timeoutMs: SHORT_TIMEOUT_MS });
    return { broker, alexa, executed, desktopCalls, logs };
}

test('shouldExecuteShutdownEndToEndAndAckDone', async () => {
    const { alexa, executed } = await startAgent();
    const { result } = await alexa('desligar_em_minutos', { minutos: 15 });
    assert.equal(result, DeliveryResult.DONE);
    assert.deepEqual(executed, [{ file: 'C:\\Windows\\System32\\shutdown.exe', args: ['/s', '/t', '900'] }]);
});

test('shouldRouteScreenActionsToDesktopSession', async () => {
    const { alexa, executed, desktopCalls } = await startAgent();
    assert.equal((await alexa('abrir_netflix', {})).result, DeliveryResult.DONE);
    assert.deepEqual(desktopCalls, [{ actionId: 'abrir_netflix', params: {} }]);
    assert.equal(executed.length, 0);
});

test('shouldAckFailureWhenDesktopSessionIsAbsent', async () => {
    const { alexa } = await startAgent({ desktopResult: { ok: false, reason: 'no_desktop_session' } });
    assert.equal((await alexa('abrir_netflix', {})).result, DeliveryResult.FAILED);
});

test('shouldRefuseEverythingWhilePaused', async () => {
    const { alexa, executed } = await startAgent({ paused: true });
    assert.equal((await alexa('cancelar_desligamento', {})).result, DeliveryResult.FAILED);
    assert.equal(executed.length, 0);
});

test('shouldAckFailureForDisabledOrUnconfiguredAction', async () => {
    const { alexa } = await startAgent();
    assert.equal((await alexa('reiniciar_pc', {})).result, DeliveryResult.FAILED);
    assert.equal((await alexa('backup_documentos', {})).result, DeliveryResult.FAILED);
});

test('shouldIgnoreForgedCommandWithoutAnyAck', async () => {
    const { broker, executed, logs } = await startAgent();
    const forged = protocol.createCommand({ actionId: 'cancelar_desligamento' }, 'f'.repeat(43));
    await broker.connect().publish(protocol.commandTopic(CONFIG.deviceId), protocol.serialize(forged));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(executed.length, 0);
    assert.equal(broker.published.filter((m) => m.topic.endsWith('/ack')).length, 0);
    assert.equal(logs.find((e) => e.event === 'command_rejected').reason, 'bad_signature');
});

test('shouldExecuteReplayedCommandOnlyOnce', async () => {
    const { broker, executed } = await startAgent();
    const command = protocol.serialize(protocol.createCommand({ actionId: 'cancelar_desligamento' }, CONFIG.hmacSecret));
    const attacker = broker.connect();
    await attacker.publish(protocol.commandTopic(CONFIG.deviceId), command);
    await attacker.publish(protocol.commandTopic(CONFIG.deviceId), command);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(executed.length, 1);
});

test('shouldRejectSignedCommandWithOutOfRangeParam', async () => {
    const { alexa, executed } = await startAgent();
    assert.equal((await alexa('desligar_em_minutos', { minutos: 999 })).result, DeliveryResult.FAILED);
    assert.equal(executed.length, 0);
});

test('shouldCarryProgramChoicesFromDesktopToAlexa', async () => {
    const desktopResult = { ok: false, status: 'ambiguous', choices: ['Cloudflare WARP', 'Cloudflare One'] };
    const { alexa, desktopCalls } = await startAgent({ desktopResult });
    const reply = await alexa('abrir_programa', { programa: 'cloudflare', verbo: 'abrir', exato: 0 });
    assert.equal(reply.result, DeliveryResult.AMBIGUOUS);
    assert.deepEqual(reply.choices, ['Cloudflare WARP', 'Cloudflare One']);
    assert.deepEqual(desktopCalls, [{ actionId: 'abrir_programa', params: { programa: 'cloudflare', verbo: 'abrir', exato: 0 } }]);
});

test('shouldPassFreePhraseVerbToDesktop', async () => {
    const { alexa, desktopCalls } = await startAgent();
    await alexa('abrir_programa', { programa: 'x', verbo: '*', exato: 0 });
    assert.equal(desktopCalls[0].params.verbo, '*');
});

test('shouldCarryClaudeSummaryInSignedAck', async () => {
    const { alexa } = await startAgent({ desktopResult: { ok: true, text: 'A capital é Canberra.' } });
    const reply = await alexa('resposta_claude', {});
    assert.deepEqual([reply.result, reply.text], [DeliveryResult.DONE, 'A capital é Canberra.']);
});
