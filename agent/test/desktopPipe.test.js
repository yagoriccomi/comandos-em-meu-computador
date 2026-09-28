'use strict';
/* Named pipe real (Windows) entre o núcleo e a sessão de desktop. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { publicCatalog } = require('../src/shared');
const { buildLocalActions } = require('../src/config/localActions');
const { createDesktopBridge } = require('../src/core/desktopBridge');
const { createDesktopSession, createStatusFileWriter, TrayState } = require('../src/desktop/desktopSession');

const SECRET = 'p'.repeat(43);
const silentLogger = { info() {}, warn() {}, error() {} };
const onlyOnWindows = { skip: process.platform !== 'win32' };

const localActions = buildLocalActions({ actions: [
    { id: 'abrir_netflix', executable: 'C:\\Windows\\explorer.exe', args: ['https://www.netflix.com'], enabled: true },
    { id: 'cancelar_desligamento', executable: 'C:\\Windows\\System32\\shutdown.exe', args: ['/a'], enabled: true },
] }, publicCatalog, { checkFileExists: false });

function uniquePipeName() {
    return `\\\\.\\pipe\\o-monstro-teste-${crypto.randomUUID()}`;
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
    const pipeName = uniquePipeName();
    const statusFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-status-')), 'status.json');
    const core = { paused: false, shutdown: false };
    const bridge = createDesktopBridge({
        pipeName,
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
        pipeName,
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

test('shouldExecuteScreenActionThroughAuthenticatedPipe', onlyOnWindows, async () => {
    const { bridge, session, executed } = await setup();
    await waitFor(() => bridge.isConnected() && session.isConnected());
    assert.deepEqual(await bridge.execute('abrir_netflix', {}), { ok: true });
    assert.deepEqual(executed, [{ id: 'abrir_netflix', params: {} }]);
    session.stop();
    await bridge.close();
});

test('shouldRefuseNonScreenActionInDesktopSession', onlyOnWindows, async () => {
    const { bridge, session, executed } = await setup();
    await waitFor(() => bridge.isConnected());
    assert.deepEqual(await bridge.execute('cancelar_desligamento', {}), { ok: false });
    assert.equal(executed.length, 0);
    session.stop();
    await bridge.close();
});

test('shouldRejectSessionWithWrongSecret', onlyOnWindows, async () => {
    const { bridge, session } = await setup({ sessionSecret: 'errado'.repeat(8) });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(bridge.isConnected(), false);
    assert.deepEqual(await bridge.execute('abrir_netflix', {}), { ok: false, reason: 'no_desktop_session' });
    session.stop();
    await bridge.close();
});

test('shouldDropClientThatNeverAuthenticates', onlyOnWindows, async () => {
    const pipeName = uniquePipeName();
    const bridge = createDesktopBridge({ pipeName, pipeSecret: SECRET, logger: silentLogger, getStatus: () => ({}), onPauseChange() {}, onShutdownRequested() {} });
    await bridge.listen();
    const socket = net.connect(pipeName);
    socket.on('error', () => {});
    socket.write('x'.repeat(10000));
    await new Promise((resolve) => socket.on('close', resolve));
    assert.equal(bridge.isConnected(), false);
    await bridge.close();
});

test('shouldPauseAndResumeFromTrayAndReflectStatus', onlyOnWindows, async () => {
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

test('shouldShowCoreDownAndNoticeWhenCoreStops', onlyOnWindows, async () => {
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

test('shouldForwardShutdownRequestToCore', onlyOnWindows, async () => {
    const { bridge, session, core } = await setup();
    await waitFor(() => session.isConnected());
    session.shutdownCore();
    await waitFor(() => core.shutdown);
    session.stop();
    await bridge.close();
});

test('shouldFailPendingDesktopActionWhenSessionTimesOut', onlyOnWindows, async () => {
    const { bridge, session } = await setup({ executeResult: new Promise(() => {}) });
    await waitFor(() => bridge.isConnected());
    assert.deepEqual(await bridge.execute('abrir_netflix', {}), { ok: false, reason: 'desktop_timeout' });
    session.stop();
    await bridge.close();
});
