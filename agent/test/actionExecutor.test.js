'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { publicCatalog } = require('../src/shared');
const { buildLocalActions } = require('../src/config/localActions');
const { createActionExecutor } = require('../src/executor/actionExecutor');

const local = buildLocalActions({ actions: [
    { id: 'desligar_em_minutos', executable: 'C:\\Windows\\System32\\shutdown.exe', args: ['/s', '/t', '{minutos*60}'], enabled: true },
    { id: 'abrir_netflix', executable: 'C:\\Windows\\explorer.exe', args: ['https://www.netflix.com'], successExitCodes: [0, 1], enabled: true },
    { id: 'backup_documentos', executable: 'C:\\backup\\backup.exe', args: ['--tudo'], waitForExit: false, enabled: true },
    { id: 'reiniciar_pc', enabled: false },
] }, publicCatalog, { checkFileExists: false });

const silentLogger = { info() {}, warn() {}, error() {} };

function fakeExecFile({ error = null, stdout = '', stderr = '' } = {}) {
    const calls = [];
    const execFile = (file, args, options, callback) => {
        calls.push({ file, args, options });
        setImmediate(() => callback(error, stdout, stderr));
    };
    return { execFile, calls };
}

test('shouldRunShutdownWithSecondsComputedFromValidatedMinutes', async () => {
    const { execFile, calls } = fakeExecFile();
    const result = await createActionExecutor({ execFile, logger: silentLogger }).execute(local.get('desligar_em_minutos'), { minutos: 30 });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls[0].args, ['/s', '/t', '1800']);
    assert.equal(calls[0].file, 'C:\\Windows\\System32\\shutdown.exe');
    assert.equal(calls[0].options.shell, false);
});

test('shouldNeverExecuteWithInvalidParams', async () => {
    const { execFile, calls } = fakeExecFile();
    const executor = createActionExecutor({ execFile, logger: silentLogger });
    for (const params of [{ minutos: 0 }, { minutos: 241 }, { minutos: '30 & del' }, { minutos: 2.5 }, {}, { minutos: 5, extra: 1 }, null]) {
        assert.deepEqual(await executor.execute(local.get('desligar_em_minutos'), params), { ok: false });
    }
    assert.equal(calls.length, 0);
});

test('shouldRefuseDisabledAction', async () => {
    const { execFile, calls } = fakeExecFile();
    assert.deepEqual(await createActionExecutor({ execFile, logger: silentLogger }).execute(local.get('reiniciar_pc'), {}), { ok: false });
    assert.equal(calls.length, 0);
});

test('shouldAcceptConfiguredNonZeroExitCode', async () => {
    const { execFile } = fakeExecFile({ error: Object.assign(new Error('exit 1'), { code: 1 }) });
    assert.deepEqual(await createActionExecutor({ execFile, logger: silentLogger }).execute(local.get('abrir_netflix'), {}), { ok: true });
});

test('shouldFailOnUnexpectedExitCode', async () => {
    const { execFile } = fakeExecFile({ error: Object.assign(new Error('exit 1190'), { code: 1190 }) });
    assert.deepEqual(await createActionExecutor({ execFile, logger: silentLogger }).execute(local.get('desligar_em_minutos'), { minutos: 5 }), { ok: false });
});

test('shouldFailOnTimeout', async () => {
    const { execFile } = fakeExecFile({ error: Object.assign(new Error('killed'), { code: null, killed: true }) });
    assert.deepEqual(await createActionExecutor({ execFile, logger: silentLogger }).execute(local.get('abrir_netflix'), {}), { ok: false });
});

test('shouldLogOutputOnlyThroughLocalLogger', async () => {
    const entries = [];
    const { execFile } = fakeExecFile({ stdout: 'saida do comando' });
    await createActionExecutor({ execFile, logger: { ...silentLogger, info: (e) => entries.push(e) } }).execute(local.get('desligar_em_minutos'), { minutos: 1 });
    assert.equal(entries[0].stdout, 'saida do comando');
});

test('shouldStartLongRunningActionDetachedWithoutShell', async () => {
    const spawned = [];
    const spawn = (file, args, options) => {
        spawned.push({ file, args, options });
        const child = new EventEmitter();
        child.unref = () => {};
        setImmediate(() => child.emit('spawn'));
        return child;
    };
    const result = await createActionExecutor({ spawn, logger: silentLogger }).execute(local.get('backup_documentos'), {});
    assert.deepEqual(result, { ok: true });
    assert.equal(spawned[0].options.shell, false);
    assert.equal(spawned[0].options.detached, true);
});

test('shouldReportFailureWhenDetachedActionCannotStart', async () => {
    const spawn = () => {
        const child = new EventEmitter();
        setImmediate(() => child.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' })));
        return child;
    };
    assert.deepEqual(await createActionExecutor({ spawn, logger: silentLogger }).execute(local.get('backup_documentos'), {}), { ok: false });
});
