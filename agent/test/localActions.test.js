'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { publicCatalog } = require('../src/shared');
const { buildLocalActions, loadLocalActions, LocalActionsError } = require('../src/config/localActions');

const EXAMPLE_FILE = path.join(__dirname, '..', 'config', 'actions.example.json');
const NO_FS = { checkFileExists: false };

function build(actions) {
    return buildLocalActions({ actions }, publicCatalog, NO_FS);
}

const SHUTDOWN = { id: 'desligar_em_minutos', executable: 'C:\\Windows\\System32\\shutdown.exe', args: ['/s', '/t', '{minutos*60}'], enabled: true };

test('shouldKeepExampleActionsInSyncWithPublicCatalog', () => {
    const local = loadLocalActions(EXAMPLE_FILE, publicCatalog, NO_FS);
    assert.deepEqual([...local.ids].sort(), publicCatalog.actions.map((action) => action.id).sort());
});

test('shouldLoadExampleWithRealSystemExecutables', { skip: process.platform !== 'win32' }, () => {
    const local = loadLocalActions(EXAMPLE_FILE, publicCatalog);
    assert.equal(local.get('bloquear_tela').enabled, true);
    assert.equal(local.get('backup_documentos').enabled, false);
});

test('shouldParseParamPlaceholderWithMultiplier', () => {
    const [,, seconds] = build([SHUTDOWN]).get('desligar_em_minutos').args;
    assert.deepEqual({ ...seconds }, { paramName: 'minutos', multiplier: 60 });
});

test('shouldRejectIdOutsidePublicCatalog', () => {
    assert.throws(() => build([{ ...SHUTDOWN, id: 'formatar_disco' }]), LocalActionsError);
});

test('shouldRejectRelativeExecutable', () => {
    assert.throws(() => build([{ ...SHUTDOWN, executable: 'shutdown.exe' }]), /caminho absoluto/);
});

test('shouldRejectBatchFilesThatWouldSpawnAShell', () => {
    assert.throws(() => build([{ ...SHUTDOWN, executable: 'C:\\scripts\\desliga.bat' }]), /\.bat/);
});

test('shouldRejectParamsFlowingIntoShellInterpreters', () => {
    const viaPowerShell = { ...SHUTDOWN, executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', args: ['-Command', '{minutos}'] };
    assert.throws(() => build([viaPowerShell]), /interpretadores/);
});

test('shouldRejectPlaceholderForUndeclaredParam', () => {
    assert.throws(() => build([{ ...SHUTDOWN, args: ['/s', '/t', '{segundos}'] }]), /não existe no catálogo/);
});

test('shouldRejectMalformedPlaceholder', () => {
    assert.throws(() => build([{ ...SHUTDOWN, args: ['/t', '{minutos}0'] }]), /mal formado/);
});

test('shouldRejectSynchronousTimeoutLongerThanAlexaCanWait', () => {
    assert.throws(() => build([{ ...SHUTDOWN, timeoutMs: 60000 }]), /timeoutMs/);
});

test('shouldAllowDisabledActionWithoutExecutable', () => {
    const local = build([{ id: 'backup_documentos', enabled: false }]);
    assert.equal(local.get('backup_documentos').enabled, false);
});

test('shouldRejectDuplicatedIds', () => {
    assert.throws(() => build([SHUTDOWN, SHUTDOWN]), /duplicado/);
});
