'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessionLock, LockStatus, SESSION_DURATION_MS, MAX_FAILURES } = require('../src/claude/sessionLock');
const { createClaudeCli, findClaudeExecutable, cleanEnvironment, splitSummary, QUESTION_ARGS, NEW_ORDER_ARGS, CONTINUE_ORDER_ARGS } = require('../src/claude/claudeCli');
const { createClaudeJobs, JobState } = require('../src/claude/claudeJobs');
const { createInternalRunner } = require('../src/internal/internalActions');

const QUIET_LOGGER = { info() {}, warn() {}, error() {} };

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-claude-'));
}

// ---------- trava (PIN + sessão de 3 h) ----------
test('shouldRequirePinThenKeepSessionActiveForThreeHours', () => {
    const directory = tempDir();
    let now = 1_000_000;
    const lock = createSessionLock({ filePath: path.join(directory, 'claude-code.json'), clock: () => now });
    assert.equal(lock.check(), LockStatus.NO_PIN);
    lock.setPin('482913');
    assert.ok(!fs.readFileSync(path.join(directory, 'claude-code.json'), 'utf8').includes('482913'), 'só o hash fica no arquivo');
    assert.equal(lock.check(), LockStatus.PIN_REQUIRED);
    assert.equal(lock.check('482913'), LockStatus.OK);
    now += SESSION_DURATION_MS - 1;
    assert.equal(lock.check(), LockStatus.OK, 'sessão ainda ativa');
    now += 2;
    assert.equal(lock.check(), LockStatus.PIN_REQUIRED, 'depois de 3 h pede de novo');
    fs.rmSync(directory, { recursive: true, force: true });
});

test('shouldRevokeSessionImmediately', () => {
    const directory = tempDir();
    const lock = createSessionLock({ filePath: path.join(directory, 'c.json') });
    lock.setPin('482913');
    lock.check('482913');
    lock.revoke();
    assert.equal(lock.check(), LockStatus.PIN_REQUIRED);
    fs.rmSync(directory, { recursive: true, force: true });
});

test('shouldLockAfterTooManyWrongPinsEvenWithRightOne', () => {
    const directory = tempDir();
    let now = 5_000_000;
    const lock = createSessionLock({ filePath: path.join(directory, 'c.json'), clock: () => now });
    lock.setPin('482913');
    for (let attempt = 1; attempt < MAX_FAILURES; attempt += 1) assert.equal(lock.check('111111'), LockStatus.PIN_REQUIRED);
    assert.equal(lock.check('111111'), LockStatus.LOCKED);
    assert.equal(lock.check('482913'), LockStatus.LOCKED, 'bloqueado mesmo com o PIN certo');
    now += 15 * 60 * 1000 + 1;
    assert.equal(lock.check('482913'), LockStatus.OK);
    fs.rmSync(directory, { recursive: true, force: true });
});

test('shouldAcceptPinsFromFourToEightDigitsIncludingLeadingZero', () => {
    const directory = tempDir();
    const lock = createSessionLock({ filePath: path.join(directory, 'c.json') });
    for (const pin of ['0592', '04817', '730591', '0371946', '93051748']) {
        lock.setPin(pin);
        assert.equal(lock.check(pin), LockStatus.OK, pin);
        lock.revoke();
    }
    for (const pin of ['123', '123456789', 'abcd', '', '12a4']) assert.throws(() => lock.setPin(pin), /de 4 a 8 dígitos/, pin);
    fs.rmSync(directory, { recursive: true, force: true });
});

test('shouldRejectWeakPins', () => {
    const lock = createSessionLock({ filePath: path.join(tempDir(), 'c.json') });
    for (const pin of ['0000', '1111', '99999999', '1212', '123123', '12341234']) assert.throws(() => lock.setPin(pin), /repetidos ou padrões/, pin);
    for (const pin of ['1234', '0123', '4321', '987654', '23456789']) assert.throws(() => lock.setPin(pin), /sequências/, pin);
    for (const pin of ['2580', '159753', '1004']) assert.throws(() => lock.setPin(pin), /mais usados/, pin);
});

// ---------- CLI ----------
test('shouldFindClaudeExecutableInPreferredOrder', () => {
    const env = { APPDATA: 'C:\\A', USERPROFILE: 'C:\\U' };
    const npmExe = 'C:\\A\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    assert.equal(findClaudeExecutable({ env, exists: (file) => file === npmExe }), npmExe);
    assert.equal(findClaudeExecutable({ env, preferred: 'C:\\X\\claude.exe', exists: () => true }), 'C:\\X\\claude.exe');
    assert.equal(findClaudeExecutable({ env, preferred: 'claude.cmd', exists: () => true }), npmExe, 'nunca .cmd nem caminho relativo');
});

test('shouldDropInheritedClaudeVariables', () => {
    assert.deepEqual(cleanEnvironment({ PATH: 'x', ANTHROPIC_BASE_URL: 'y', CLAUDE_CODE_SESSION_ID: 'z', claudecode: '1' }), { PATH: 'x' });
});

test('shouldSplitSpokenSummaryFromFullAnswer', () => {
    assert.deepEqual(splitSummary('Canberra é a capital.\nDetalhes **aqui**.\nRESUMO: A capital da Austrália é Canberra.', 400),
        { full: 'Canberra é a capital.\nDetalhes **aqui**.', summary: 'A capital da Austrália é Canberra.' });
    assert.equal(splitSummary('sem resumo '.repeat(100), 50).summary.length, 50);
});

function fakeSpawn(replies) {
    const calls = [];
    const spawn = (file, args, options) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        let input = '';
        child.stdin = { end: (text) => {
            input = text;
            const reply = replies.shift();
            setImmediate(() => {
                child.stdout.emit('data', JSON.stringify(reply));
                child.emit('close', 0);
            });
        } };
        child.kill = () => {};
        calls.push({ file, args, options, get input() { return input; } });
        return child;
    };
    return { spawn, calls };
}

test('shouldSendSpokenTextOnlyThroughStdinWithFixedArguments', async () => {
    const { spawn, calls } = fakeSpawn([{ result: 'oi\nRESUMO: oi', is_error: false }]);
    const cli = createClaudeCli({ spawn, findExecutable: () => 'C:\\claude.exe' });
    const reply = await cli.run({ args: QUESTION_ARGS, prompt: 'pergunta"; rm -rf /', cwd: 'C:\\tmp', timeoutMs: 1000 });
    assert.equal(reply.isError, false);
    assert.equal(calls[0].input, 'pergunta"; rm -rf /');
    assert.ok(!calls[0].args.some((arg) => arg.includes('rm -rf')), 'texto falado nunca vira argumento');
    assert.equal(calls[0].options.shell, false);
    assert.ok(calls[0].args.includes('WebSearch,WebFetch') && calls[0].args.includes('dontAsk'));
});

// ---------- tarefas ----------
function jobsWith(replies) {
    const directory = tempDir();
    const spoken = [];
    const notices = [];
    const { spawn, calls } = fakeSpawn(replies);
    const jobs = createClaudeJobs({
        cli: createClaudeCli({ spawn, findExecutable: () => 'C:\\claude.exe' }),
        files: { answerFile: path.join(directory, 'r.json'), answerTextFile: path.join(directory, 'r.txt'), questionsDir: path.join(directory, 'q') },
        speak: (text) => spoken.push(text),
        notify: (text) => notices.push(text),
        logger: QUIET_LOGGER,
    });
    return { jobs, spoken, notices, calls, directory };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('shouldAnswerInBackgroundThenSpeakAndKeepSummary', async () => {
    const { jobs, spoken, notices, directory } = jobsWith([{ result: 'Resposta longa.\nRESUMO: Canberra.', is_error: false }]);
    assert.equal(jobs.lastAnswer().state, JobState.NONE);
    jobs.ask('capital da austrália');
    assert.equal(jobs.lastAnswer().state, JobState.RUNNING);
    await settle();
    assert.deepEqual(jobs.lastAnswer(), { state: JobState.DONE, summary: 'Canberra.' });
    assert.deepEqual(spoken, ['Canberra.']);
    assert.match(notices[0], /Canberra/);
    assert.equal(fs.readFileSync(path.join(directory, 'r.txt'), 'utf8').trim(), 'Resposta longa.');
});

test('shouldExplainLoginWhenClaudeCodeIsLoggedOut', async () => {
    const { jobs, spoken } = jobsWith([{ result: 'Not logged in · Please run /login', is_error: true }]);
    jobs.ask('x');
    await settle();
    assert.match(spoken[0], /sem login/);
});

test('shouldContinueLastChatOrOpenNewChatWithOpus', async () => {
    const folder = tempDir();
    const { jobs, calls } = jobsWith([{ result: 'ok', is_error: false }, { result: 'ok', is_error: false }]);
    jobs.order('rode os testes', folder);
    await settle();
    jobs.order('novo chat, crie um README', folder);
    await settle();
    assert.deepEqual(calls[0].args.slice(0, CONTINUE_ORDER_ARGS.length), [...CONTINUE_ORDER_ARGS]);
    assert.deepEqual(calls[1].args.slice(0, NEW_ORDER_ARGS.length), [...NEW_ORDER_ARGS]);
    assert.equal(calls[1].input, 'crie um README');
    assert.equal(calls[0].options.cwd, folder);
});

test('shouldOpenNewChatWhenFolderHasNoConversationYet', async () => {
    const folder = tempDir();
    const { jobs, calls } = jobsWith([{ result: 'No conversation found to continue', is_error: true }, { result: 'feito\nRESUMO: feito', is_error: false }]);
    jobs.order('rode os testes', folder);
    await settle();
    assert.equal(calls.length, 2);
    assert.ok(calls[1].args.includes('opus'));
});

test('shouldRefuseOrderWithoutProjectFolder', () => {
    const { jobs } = jobsWith([]);
    assert.throws(() => jobs.order('x', undefined), (error) => error.code === 'no_project_folder');
    assert.throws(() => jobs.order('x', 'C:\\nao\\existe'), (error) => error.code === 'no_project_folder');
});

// ---------- ações internas ----------
function runnerWith({ lockStatus = LockStatus.OK, answer = { state: JobState.NONE }, folder = { status: 'ok', folder: 'C:\\P', order: 'rode os testes' } } = {}) {
    const asked = [];
    const ordered = [];
    const notices = [];
    let revoked = false;
    const runner = createInternalRunner({
        inputHelper: { run: async () => 'ok' },
        loadPrograms: () => ({ programs: [] }),
        launcher: { openApp: async () => true, openUrl: async () => true },
        claudeJobs: { ask: (text) => asked.push(text), order: (text, where) => ordered.push([text, where]), lastAnswer: () => answer },
        claudeFolders: { resolve: () => folder },
        sessionLock: { check: () => lockStatus, revoke: () => { revoked = true; } },
        notify: (text) => notices.push(text),
        logger: QUIET_LOGGER,
    });
    return { runner, asked, ordered, notices, wasRevoked: () => revoked };
}

test('shouldStartQuestionAndReadSummaryStates', async () => {
    const { runner, asked } = runnerWith();
    assert.deepEqual(await runner.run('perguntar_claude', { pergunta: 'oi' }), { ok: true });
    assert.deepEqual(asked, ['oi']);
    assert.deepEqual(await runner.run('resposta_claude', {}), { ok: false, status: 'not_found' });
    assert.deepEqual(await runnerWith({ answer: { state: JobState.RUNNING } }).runner.run('resposta_claude', {}), { ok: false, status: 'pending' });
    assert.deepEqual(await runnerWith({ answer: { state: JobState.DONE, summary: 'Canberra.' } }).runner.run('resposta_claude', {}), { ok: true, text: 'Canberra.' });
});

test('shouldGateOrdersBySessionLock', async () => {
    assert.deepEqual(await runnerWith({ lockStatus: LockStatus.PIN_REQUIRED }).runner.run('claude_code_ordem', { ordem: 'x' }), { ok: false, status: 'pin_required' });
    assert.deepEqual(await runnerWith({ lockStatus: LockStatus.LOCKED }).runner.run('claude_code_ordem', { ordem: 'x', pin: '111111' }), { ok: false, status: 'locked' });
    const noPin = runnerWith({ lockStatus: LockStatus.NO_PIN });
    assert.deepEqual(await noPin.runner.run('claude_code_ordem', { ordem: 'x' }), { ok: false });
    assert.match(noPin.notices[0], /Defina o PIN/);
    const open = runnerWith();
    assert.deepEqual(await open.runner.run('claude_code_ordem', { ordem: 'rode os testes' }), { ok: true });
    assert.deepEqual(open.ordered, [['rode os testes', 'C:\\P']]);
    const ambiguous = runnerWith({ folder: { status: 'ambiguous', choices: ['Gerador-de-Imagens', 'Calculo-de-Recisao'] } });
    assert.deepEqual(await ambiguous.runner.run('claude_code_ordem', { ordem: 'no projeto x faça y' }),
        { ok: false, status: 'ambiguous', choices: ['Gerador-de-Imagens', 'Calculo-de-Recisao'] });
    const noDefault = runnerWith({ folder: { status: 'no_default' } });
    assert.deepEqual(await noDefault.runner.run('claude_code_ordem', { ordem: 'faça y' }), { ok: false });
    assert.match(noDefault.notices[0], /pasta padrão/);
    const locked = runnerWith({ lockStatus: LockStatus.PIN_REQUIRED, folder: { status: 'ambiguous', choices: ['segredo'] } });
    assert.deepEqual(await locked.runner.run('claude_code_ordem', { ordem: 'no projeto x y' }), { ok: false, status: 'pin_required' }, 'sem PIN, nem os nomes dos projetos saem do PC');
    const end = runnerWith();
    assert.deepEqual(await end.runner.run('claude_code_encerrar', {}), { ok: true });
    assert.equal(end.wasRevoked(), true);
});
