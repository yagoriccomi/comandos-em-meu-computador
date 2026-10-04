'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProgramsManager, normalizeInvocationName, buildRoutineSuggestions, DEFAULT_INVOCATION_NAME } = require('../src/programs/programsManager');
const { mergeInternalActions } = require('../src/install/installer');
const { INTERNAL_ACTION_IDS } = require('../src/internal/internalActionIds');

function tempFiles() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-manager-'));
    return {
        directory,
        files: {
            PROGRAMS_FILE: path.join(directory, 'programas.json'),
            PREFERENCES_FILE: path.join(directory, 'preferencias.json'),
            ROUTINES_FILE: path.join(directory, 'rotinas.txt'),
        },
    };
}

const DETECTED = [
    { name: 'Discord', appId: 'com.squirrel.Discord.Discord', folder: 'C:\\D', exes: ['Discord.exe'] },
    { name: 'Visual Studio Code', appId: 'Microsoft.VisualStudioCode', folder: 'C:\\VS', exes: ['Code.exe'] },
];

function fakeScan(result) {
    return (file, args, options, callback) => setImmediate(() => callback(null, JSON.stringify(result), ''));
}

test('shouldAcceptInvocationNamesWithEitherArticle', () => {
    assert.equal(normalizeInvocationName('  A   Morgana '), 'a morgana');
    assert.equal(normalizeInvocationName('o monstro'), 'o monstro');
    assert.equal(normalizeInvocationName('morgana'), 'morgana');
    for (const invalid of ['', 'o', 'monstro; del', 'o monstro 2', 'a b', 'um nome muito longo demais para ser aceito']) {
        assert.equal(normalizeInvocationName(invalid), undefined, invalid);
    }
});

test('shouldRefreshCreateListAndKeepEditsOnNextRefresh', async () => {
    const { directory, files } = tempFiles();
    const manager = createProgramsManager({ files, scanScript: 'scan.ps1', execFile: fakeScan(DETECTED) });
    assert.deepEqual(await manager.refresh(), { total: 2, active: 2 });
    const saved = JSON.parse(fs.readFileSync(files.PROGRAMS_FILE, 'utf8'));
    saved.programas.find((entry) => entry.nome === 'Discord').apelidos = ['disc'];
    fs.writeFileSync(files.PROGRAMS_FILE, JSON.stringify(saved));
    await manager.refresh();
    assert.deepEqual(manager.load().programs.find((program) => program.name === 'Discord').aliases, ['disc']);
    fs.rmSync(directory, { recursive: true, force: true });
});

test('shouldStoreInvocationNameAndUseItInRoutineSuggestions', async () => {
    const { directory, files } = tempFiles();
    const manager = createProgramsManager({ files, scanScript: 'scan.ps1', execFile: fakeScan(DETECTED) });
    assert.equal(manager.invocationName(), DEFAULT_INVOCATION_NAME);
    assert.equal(manager.setInvocationName('A Morgana'), 'a morgana');
    assert.throws(() => manager.setInvocationName('x & y'), /nome inválido/);
    await manager.refresh();
    const text = fs.readFileSync(manager.writeRoutineSuggestions(), 'utf8');
    assert.match(text, /FRASE: vs code\r\nAÇÃO: {2}pede para a morgana vs code/);
    fs.rmSync(directory, { recursive: true, force: true });
});

test('shouldExplainWhenThereAreNoAliasesForRoutines', () => {
    assert.match(buildRoutineSuggestions({ programs: [] }, 'o monstro'), /Nenhum programa com apelido/);
});

test('shouldAddMissingInternalActionsWithoutTouchingOwnerActions', () => {
    const owner = { actions: [{ id: 'abrir_netflix', executable: 'C:\\Windows\\explorer.exe', args: ['x'], enabled: false }, { id: 'pular', interno: true, enabled: false }] };
    const { content, added } = mergeInternalActions(owner);
    assert.ok(!added.includes('pular'), 'o que o dono desligou continua desligado');
    assert.deepEqual(content.actions[0], owner.actions[0]);
    assert.equal(content.actions.length, 2 + INTERNAL_ACTION_IDS.length - 1);
});
