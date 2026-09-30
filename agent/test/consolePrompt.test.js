'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const { createConsolePrompt } = require('../src/install/consolePrompt');

/** Console falso: entrada controlada pelo teste e saída capturada. */
function fakeConsole() {
    const input = new PassThrough();
    input.isTTY = false;
    input.rawModes = [];
    input.setRawMode = (value) => {
        input.isRaw = value;
        input.rawModes.push(value);
    };
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk) => { written += chunk; });
    return { input, output, screen: () => written };
}

test('shouldShowQuestionAndReturnTypedUsername', async () => {
    const { input, output, screen } = fakeConsole();
    const prompt = createConsolePrompt({ input, output });
    const answer = prompt.ask('  Usuário da credencial do PC', { defaultValue: 'pc-o-monstro' });
    input.write('meu-usuario\n');
    assert.equal(await answer, 'meu-usuario');
    assert.match(screen(), /Usuário da credencial do PC \[pc-o-monstro\]: /);
});

test('shouldUseDefaultWhenUsernameIsEmpty', async () => {
    const { input, output } = fakeConsole();
    const answer = createConsolePrompt({ input, output }).ask('Usuário', { defaultValue: 'pc-o-monstro' });
    input.write('\n');
    assert.equal(await answer, 'pc-o-monstro');
});

test('shouldReadPasswordWithoutEchoingIt', async () => {
    const { input, output, screen } = fakeConsole();
    const answer = createConsolePrompt({ input, output }).ask('  Senha', { hidden: true });
    input.write('S3nha Forte!\r');
    assert.equal(await answer, 'S3nha Forte!');
    assert.ok(!screen().includes('S3nha'), 'a senha nunca aparece na tela');
    assert.match(screen(), /Senha: \*{12}\n/);
    assert.deepEqual(input.rawModes, [true, false]);
});

test('shouldHandleBackspaceInPassword', async () => {
    const { input, output } = fakeConsole();
    const answer = createConsolePrompt({ input, output }).ask('Senha', { hidden: true });
    input.write('abcX\u007fd\r');
    assert.equal(await answer, 'abcd');
});

test('shouldAskUsernameThenPasswordInSeparateFields', async () => {
    const { input, output, screen } = fakeConsole();
    const prompt = createConsolePrompt({ input, output });
    const user = prompt.ask('  Usuário', { defaultValue: 'pc-o-monstro' });
    input.write('\n');
    assert.equal(await user, 'pc-o-monstro');
    const password = prompt.ask('  Senha', { hidden: true });
    input.write('segredo\r');
    assert.equal(await password, 'segredo');
    assert.match(screen(), /Usuário \[pc-o-monstro\]: [\s\S]*\n  Senha: \*{7}\n$/);
});

test('shouldCallInterruptOnCtrlC', async () => {
    const { input, output } = fakeConsole();
    let interrupted = false;
    createConsolePrompt({ input, output, onInterrupt: () => { interrupted = true; } }).ask('Senha', { hidden: true });
    input.write('ab\u0003');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(interrupted, true);
});
