'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    DEFAULT_VERBS, programId, parseProgramList, serializeProgramList, mergeDetected, emptyProgramList, loadProgramList, saveProgramList,
} = require('../src/programs/programList');

const DISCORD = { name: 'Discord', appId: 'com.squirrel.Discord.Discord', folder: 'C:\\Users\\x\\AppData\\Local\\Discord', exes: ['Discord.exe', 'Update.exe'] };
const VS_CODE = { name: 'Visual Studio Code', appId: 'Microsoft.VisualStudioCode', folder: 'C:\\Program Files\\Microsoft VS Code', exes: ['Code.exe'] };
const UNINSTALL = { name: 'Uninstall God of War - Ragnarok', appId: 'C:\\Games\\GoW\\unins000.exe', folder: 'C:\\Games\\GoW', exes: ['unins000.exe'] };
const SCRIPT = { name: 'Alternar para TV', appId: 'E:\\scripts\\tv.pyw', folder: '', exes: [] };

function roundTrip(list) {
    return parseProgramList(JSON.parse(serializeProgramList(list)));
}

test('shouldCreateListFromDetectionWithDefaults', () => {
    const list = mergeDetected(emptyProgramList(), [DISCORD, VS_CODE, UNINSTALL, SCRIPT]);
    const byName = Object.fromEntries(list.programs.map((program) => [program.name, program]));
    assert.deepEqual(byName.Discord.processes.map((target) => target.exe), ['Discord.exe', 'Update.exe']);
    assert.deepEqual(byName['Visual Studio Code'].aliases, ['vs code', 'vscode', 'code']);
    assert.equal(byName['Uninstall God of War - Ragnarok'].active, false, 'desinstaladores começam desligados');
    assert.equal(byName['Alternar para TV'].active, true);
    assert.deepEqual(byName['Alternar para TV'].processes, []);
    assert.deepEqual(list.verbs, { abrir: [...DEFAULT_VERBS.abrir], fechar: [...DEFAULT_VERBS.fechar], destravar: [...DEFAULT_VERBS.destravar] });
});

test('shouldKeepOwnerEditsWhenDetectingAgain', () => {
    const first = roundTrip(mergeDetected(emptyProgramList(), [DISCORD, SCRIPT]));
    const discord = first.programs.find((program) => program.name === 'Discord');
    discord.aliases = ['disc'];
    discord.disabledVerbs = ['ligar'];
    discord.processes.push({ folder: 'C:\\Outro', exe: 'helper.exe' });
    const tv = first.programs.find((program) => program.name === 'Alternar para TV');
    tv.aliases = ['alterna para a tv', 'troca para a tv'];

    const second = mergeDetected(first, [{ ...DISCORD, appId: 'novo.app.id' }]);
    const merged = second.programs.find((program) => program.name === 'Discord');
    assert.deepEqual(merged.aliases, ['disc']);
    assert.deepEqual(merged.disabledVerbs, ['ligar']);
    assert.equal(merged.appId, 'novo.app.id');
    assert.ok(merged.processes.some((target) => target.exe === 'helper.exe'));
    assert.ok(second.programs.some((program) => program.name === 'Alternar para TV'), 'personalizado não some mesmo sem ser detectado');
});

test('shouldDropUninstalledProgramsThatWereNotCustomized', () => {
    const first = mergeDetected(emptyProgramList(), [DISCORD, VS_CODE]);
    const second = mergeDetected(first, [DISCORD]);
    assert.deepEqual(second.programs.map((program) => program.name), ['Discord']);
});

test('shouldSkipInvalidEntriesFromHandEditedFile', () => {
    const list = parseProgramList({
        programas: [
            { nome: 'Bom', abrirCom: 'app.id', processos: [{ pasta: 'C:\\Bom', exe: 'bom.exe' }] },
            { nome: 'Sem como abrir' },
            { nome: 'Aspas', abrirCom: 'x" & del' },
            { nome: 'Processo ruim', abrirCom: 'app.ok', processos: [{ pasta: '..\\relativo', exe: 'x.exe' }, { pasta: 'C:\\a', exe: 'x.bat' }] },
        ],
    });
    assert.deepEqual(list.programs.map((program) => program.name), ['Bom', 'Processo ruim']);
    assert.equal(list.skipped, 2);
    assert.deepEqual(list.programs[1].processes, [], 'processos inválidos são ignorados');
});

test('shouldKeepStableIdEvenIfOwnerRenamesProgram', () => {
    const list = roundTrip(mergeDetected(emptyProgramList(), [DISCORD]));
    list.programs[0].name = 'Meu Discord';
    const again = roundTrip(list);
    assert.equal(again.programs[0].id, programId('Discord'));
});

test('shouldSaveAndLoadPrivateFile', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-programas-'));
    const file = path.join(directory, 'sub', 'programas.json');
    saveProgramList(file, mergeDetected(emptyProgramList(), [DISCORD]));
    assert.equal(loadProgramList(file).programs[0].name, 'Discord');
    fs.writeFileSync(file, '{ quebrado');
    assert.throws(() => loadProgramList(file), /JSON válido/);
    fs.rmSync(directory, { recursive: true, force: true });
});
