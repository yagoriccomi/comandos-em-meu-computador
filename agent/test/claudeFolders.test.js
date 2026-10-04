'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClaudeFolders, scanClaudeProjects, FolderStatus } = require('../src/claude/claudeFolders');

function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-folders-'));
    const projectsDir = path.join(root, 'projects');
    const folders = {};
    for (const name of ['comandos-em-meu-computador', 'Gerador-de-Imagens', 'Calculo-de-Recisao', 'Gerador-de-Videos']) {
        folders[name] = path.join(root, 'work', name);
        fs.mkdirSync(folders[name], { recursive: true });
        const historyDir = path.join(projectsDir, name);
        fs.mkdirSync(historyDir, { recursive: true });
        fs.writeFileSync(path.join(historyDir, 'a.jsonl'), `{"type":"summary"}\n{"cwd":${JSON.stringify(folders[name])},"type":"user"}\n`);
    }
    fs.mkdirSync(path.join(projectsDir, 'apagada'));
    fs.writeFileSync(path.join(projectsDir, 'apagada', 'b.jsonl'), `{"cwd":${JSON.stringify(path.join(root, 'nao-existe'))}}\n`);
    const listFile = path.join(root, 'pastas.json');
    return { root, projectsDir, folders, listFile, list: createClaudeFolders({ listFile, projectsDir }) };
}

test('shouldImportOnlyExistingFoldersFromClaudeCodeHistory', () => {
    const { root, projectsDir, list, listFile } = setup();
    assert.equal(scanClaudeProjects(projectsDir).length, 4, 'a pasta apagada não entra');
    assert.deepEqual(list.importFromClaudeCode(), { total: 4, active: 4 });
    const saved = JSON.parse(fs.readFileSync(listFile, 'utf8'));
    assert.equal(saved.pastas.filter((entry) => entry.padrao).length, 1, 'uma única pasta padrão');
    fs.rmSync(root, { recursive: true, force: true });
});

test('shouldRouteOrderToNamedProjectAndStripTheName', () => {
    const { root, folders, list } = setup();
    list.importFromClaudeCode();
    assert.deepEqual(list.resolve('no projeto calculo de recisao rode os testes'),
        { status: FolderStatus.OK, folder: folders['Calculo-de-Recisao'], order: 'rode os testes' });
    assert.deepEqual(list.resolve('na pasta comandos, atualize o readme'),
        { status: FolderStatus.OK, folder: folders['comandos-em-meu-computador'], order: 'atualize o readme' });
    fs.rmSync(root, { recursive: true, force: true });
});

test('shouldAskWhichProjectWhenNameIsAmbiguousAndAcceptTheChoice', () => {
    const { root, folders, list } = setup();
    list.importFromClaudeCode();
    const ambiguous = list.resolve('no projeto gerador crie um teste');
    assert.equal(ambiguous.status, FolderStatus.AMBIGUOUS);
    assert.deepEqual([...ambiguous.choices].sort(), ['Gerador-de-Imagens', 'Gerador-de-Videos']);
    assert.deepEqual(list.resolve('no projeto gerador crie um teste', 'Gerador-de-Videos'),
        { status: FolderStatus.OK, folder: folders['Gerador-de-Videos'], order: 'crie um teste' });
    fs.rmSync(root, { recursive: true, force: true });
});

test('shouldUseDefaultFolderWithoutProjectPrefixAndAddFolderAsDefault', () => {
    const { root, folders, list } = setup();
    assert.equal(list.resolve('rode os testes').status, FolderStatus.NO_DEFAULT);
    list.importFromClaudeCode();
    list.addFolder(folders['Gerador-de-Imagens']);
    assert.deepEqual(list.resolve('rode os testes'), { status: FolderStatus.OK, folder: folders['Gerador-de-Imagens'], order: 'rode os testes' });
    assert.throws(() => list.addFolder('C:\\nao\\existe'), /pasta inválida/);
    fs.rmSync(root, { recursive: true, force: true });
});

test('shouldSayNotFoundForUnknownProject', () => {
    const { root, list } = setup();
    list.importFromClaudeCode();
    assert.equal(list.resolve('no projeto banana xpto faça algo').status, FolderStatus.NOT_FOUND);
    fs.rmSync(root, { recursive: true, force: true });
});
