'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMasker, createLocalLogger, MAX_LOG_BYTES } = require('../src/logger/localLogger');

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-log-'));
}

test('shouldMaskWindowsProfilePaths', () => {
    const mask = createMasker([]);
    assert.equal(mask('C:\\Users\\Fulano\\Documents\\a.txt'), 'C:\\Users\\<usuario>\\Documents\\a.txt');
    assert.equal(mask('d:/users/fulano/x'), 'd:/users/<usuario>/x');
});

test('shouldMaskUsernameAnywhereCaseInsensitive', () => {
    const mask = createMasker(['Fulano']);
    assert.deepEqual(mask({ stdout: 'logado como FULANO em PC-fulano', nested: ['fulano'] }),
        { stdout: 'logado como <usuario> em PC-<usuario>', nested: ['<usuario>'] });
});

test('shouldIgnoreTooShortUsernamesToAvoidMaskingEverything', () => {
    assert.equal(createMasker(['a'])('banana'), 'banana');
});

test('shouldWriteMaskedJsonLines', () => {
    const directory = tempDir();
    const logger = createLocalLogger({ directory, fileName: 'agent.log', component: 'core', usernames: ['Fulano'] });
    logger.info({ event: 'action_output', stdout: 'C:\\Users\\Fulano\\backup ok' });
    const [line] = fs.readFileSync(logger.filePath, 'utf8').trim().split('\n');
    const entry = JSON.parse(line);
    assert.equal(entry.level, 'info');
    assert.equal(entry.component, 'core');
    assert.equal(entry.stdout, 'C:\\Users\\<usuario>\\backup ok');
    assert.ok(!line.includes('Fulano'));
});

test('shouldRotateWhenFileGetsTooBig', () => {
    const directory = tempDir();
    const logger = createLocalLogger({ directory, fileName: 'agent.log', component: 'core', usernames: [] });
    fs.writeFileSync(logger.filePath, 'x'.repeat(MAX_LOG_BYTES));
    logger.info({ event: 'depois_da_rotacao' });
    assert.ok(fs.existsSync(`${logger.filePath}.1`));
    assert.match(fs.readFileSync(logger.filePath, 'utf8'), /depois_da_rotacao/);
});

test('shouldNeverThrowWhenLogDirectoryIsUnwritable', () => {
    const logger = createLocalLogger({ directory: '\0invalido', fileName: 'agent.log', component: 'core', usernames: [] });
    assert.doesNotThrow(() => logger.error({ event: 'x' }));
});
