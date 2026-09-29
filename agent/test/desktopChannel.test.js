'use strict';
/* Canal local real (TCP em 127.0.0.1) entre o núcleo e a sessão de desktop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { publicCatalog } = require('../src/shared');
const { buildLocalActions } = require('../src/config/localActions');
const { createDesktopBridge } = require('../src/core/desktopBridge');
const { createDesktopSession, createStatusFileWriter, TrayState } = require('../src/desktop/desktopSession');
const { listenOnLoopback, connectToLoopback } = require('../src/desktop/localChannel');

const SECRET = 'p'.repeat(43);
const silentLogger = { info() {}, warn() {}, error() {} };

const localActions = buildLocalActions({ actions: [
    { id: 'abrir_netflix', executable: 'C:\\Windows\\explorer.exe', args: ['https://www.netflix.com'], enabled: true },
    { id: 'cancelar_desligamento', executable: 'C:\\Windows\\System32\\shutdown.exe', args: ['/a'], enabled: true },
] }, publicCatalog, { checkFileExists: false });

function uniqueEndpointFile() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-endpoint-')), 'core-endpoint.json');
}

function waitFor(predicate, timeoutMs = 2000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
            setTimeout(tick, 10);
        };
        tick();
    });
}

async function setup({ sessionSecret = SECRET, executeResult = { ok: true } } = {}) {
    const endpointFile = uniqueEndpointFile();
    const statusFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-status-')), 'status.json');
    const core = { paused: false, shutdown: false };
    const bridge = createDesktopBridge({
        endpointFile,
        pipeSecret: SECRET,
        logger: silentLogger,
        getStatus: () => ({ broker: 'connected', paused: core.paused }),
        onPauseChange: (paused) => { core.paused = paused; },
        onShutdownRequested: () => { core.shutdown = true; },
        executeTimeoutMs: 500,
    });
    await bridge.listen();
    const executed = [];
    const session = createDesktopSession({
        endpointFile,
        pipeSecret: sessionSecret,
        localActions,
        executor: { execute: async (action, params) => { executed.push({ id: action.id, params }); return executeResult; } },
        statusWriter: createStatusFileWriter(statusFile),
        logger: silentLogger,
        reconnectDelayMs: 50,
    });
    session.start();
    const readStatus = () => JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    return { bridge, session, core, executed, readStatus };
}

test('shouldExecuteScreenActionThroughAuthenticatedChannel', async () => {
    const { bridge, session, executed } = await setup();
    await waitFor(() => bridge.isConnected() && session.isConnected());
    assert.deepEqual(await bridge.execute('abrir_netflix', {}), { ok: true });
    assert.deepEqual(executed, [{ id: 'abrir_netflix', params: {} }]);
    session.stop();
    await bridge.close();
});

test('shouldRefuseNonScreenActionInDesktopSession', async () => {
    const { bridge, session, executed } = await setup();
    await waitFor(() => bridge.isConnected());
    assert.deepEqual(await bridge.execute('cancelar_desligamento', {}), { ok: false });
    assert.equal(executed.length, 0);
    session.stop();
    await bridge.close();
});

test('shouldRejectSessionWithWrongSecret', async () => {
    const { bridge, session } = await setup({ sessionSecret: 'errado'.repeat(8) });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(bridge.isConnected(), false);
    assert.deepEqual(await bridge.execute('abrir_netflix', {}), { ok: false, reason: 'no_desktop_session' });
    session.stop();
    await bridge.close();
});

test('shouldDropClientThatNeverAuthenticates', async () => {
    const endpointFile = uniqueEndpointFile();
    const bridge = createDesktopBridge({ endpointFile, pipeSecret: SECRET, logger: silentLogger, getStatus: () => ({}), onPauseChange() {}, onShutdownRequested() {} });
    await bridge.listen();
    const socket = connectToLoopback(endpointFile);
    socket.on('error', () => {});
    socket.write('x'.repeat(10000));
    await new Promise((resolve) => socket.on('close', resolve));
    assert.equal(bridge.isConnected(), false);
    await bridge.close();
});

test('shouldPauseAndResumeFromTrayAndReflectStatus', async () => {
    const { bridge, session, core, readStatus } = await setup();
    await waitFor(() => session.getState() === TrayState.READY);
    assert.equal(session.pause(), true);
    await waitFor(() => session.getState() === TrayState.PAUSED);
    assert.equal(core.paused, true);
    assert.equal(readStatus().state, 'paused');
    session.resume();
    await waitFor(() => session.getState() === TrayState.READY);
    session.stop();
    await bridge.close();
});

test('shouldShowCoreDownAndNoticeWhenCoreStops', async () => {
    const { bridge, session, readStatus } = await setup();
    await waitFor(() => session.isConnected());
    await bridge.close();
    await waitFor(() => session.getState() === TrayState.CORE_DOWN);
    const status = readStatus();
    assert.equal(status.state, 'core_down');
    assert.match(status.notice.text, /núcleo do agente parou/);
    assert.equal(session.pause(), false);
    session.stop();
});

test('shouldForwardShutdownRequestToCore', async () => {
    const { bridge, session, core } = await setup();
    await waitFor(() => session.isConnected());
    session.shutdownCore();
    await waitFor(() => core.shutdown);
    session.stop();
    await bridge.close();
});

test('shouldFailPendingDesktopActionWhenSessionTimesOut', async () => {
    const { bridge, session } = await setup({ executeResult: new Promise(() => {}) });
    await waitFor(() => bridge.isConnected());
    assert.deepEqual(await bridge.execute('abrir_netflix', {}), { ok: false, reason: 'desktop_timeout' });
    session.stop();
    await bridge.close();
});

test('shouldNotRevealSecretToImpostorCoreServer', async () => {
    const endpointFile = uniqueEndpointFile();
    const received = [];
    const impostor = net.createServer((socket) => {
        socket.on('error', () => {}); // o cliente legítimo derruba a conexão: esperado
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            received.push(chunk);
            // Não conhece o segredo: responde com prova inventada e tenta mandar executar algo.
            socket.write(`${JSON.stringify({ type: 'challenge', nonce: 'abc', proof: 'f'.repeat(64) })}\n`);
            socket.write(`${JSON.stringify({ type: 'welcome' })}\n${JSON.stringify({ type: 'execute', id: 1, actionId: 'abrir_netflix', params: {} })}\n`);
        });
    });
    await listenOnLoopback(impostor, endpointFile);
    const executed = [];
    const session = createDesktopSession({
        endpointFile,
        pipeSecret: SECRET,
        localActions,
        executor: { execute: async (action) => { executed.push(action.id); return { ok: true }; } },
        statusWriter: { write() {}, notify() {} },
        logger: silentLogger,
        reconnectDelayMs: 10000,
    });
    session.start();
    await waitFor(() => received.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const everything = received.join('');
    assert.ok(!everything.includes(SECRET), 'o segredo nunca pode trafegar no canal');
    assert.equal(executed.length, 0, 'não executa ordens de um núcleo que não provou conhecer o segredo');
    assert.equal(session.isConnected(), false);
    session.stop();
    await new Promise((resolve) => impostor.close(resolve));
});

test('shouldListenOnlyOnLoopbackAndPublishPort', async () => {
    const endpointFile = uniqueEndpointFile();
    const bridge = createDesktopBridge({ endpointFile, pipeSecret: SECRET, logger: silentLogger, getStatus: () => ({}), onPauseChange() {}, onShutdownRequested() {} });
    const port = await bridge.listen();
    const published = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
    assert.equal(published.port, port);
    assert.ok(port > 0);
    await bridge.close();
});

test('shouldConnectWhenCoreStartsAfterDesktopSession', async () => {
    const endpointFile = uniqueEndpointFile();
    const session = createDesktopSession({
        endpointFile,
        pipeSecret: SECRET,
        localActions,
        executor: { execute: async () => ({ ok: true }) },
        statusWriter: { write() {}, notify() {} },
        logger: silentLogger,
        reconnectDelayMs: 30,
    });
    session.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(session.getState(), TrayState.CORE_DOWN, 'sem núcleo publicado, continua tentando');
    const bridge = createDesktopBridge({ endpointFile, pipeSecret: SECRET, logger: silentLogger,
        getStatus: () => ({ broker: 'connected', paused: false }), onPauseChange() {}, onShutdownRequested() {} });
    await bridge.listen();
    await waitFor(() => session.getState() === TrayState.READY);
    session.stop();
    await bridge.close();
});

test('shouldIgnoreWelcomeAndExecuteFromCoreThatSkipsTheChallenge', async (t) => {
    const endpointFile = uniqueEndpointFile();
    const impostor = net.createServer((socket) => {
        socket.on('error', () => {});
        socket.once('data', () => {
            socket.write(`${JSON.stringify({ type: 'welcome' })}\n${JSON.stringify({ type: 'execute', id: 7, actionId: 'abrir_netflix', params: {} })}\n`);
        });
    });
    await listenOnLoopback(impostor, endpointFile);
    const executed = [];
    const session = createDesktopSession({
        endpointFile,
        pipeSecret: SECRET,
        localActions,
        executor: { execute: async (action) => { executed.push(action.id); return { ok: true }; } },
        statusWriter: { write() {}, notify() {} },
        logger: silentLogger,
        reconnectDelayMs: 10000,
    });
    t.after(() => {
        session.stop();
        impostor.close();
    });
    session.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(executed.length, 0);
    assert.equal(session.isConnected(), false);
});
