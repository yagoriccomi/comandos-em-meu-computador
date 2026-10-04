'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSessionLock, LockStatus, SESSION_DURATION_MS, MAX_FAILURES } = require('../src/claude/sessionLock');
const { createClaudeCli, findClaudeExecutable, cleanEnvironment, splitSummary, QUESTION_ARGS, NEW_ORDER_ARGS, resumeOrderArgs } = require('../src/claude/claudeCli');
const { createClaudeChats, BINDING_WINDOW_MS } = require('../src/claude/claudeChats');
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

test('shouldResumeBoundChatOrOpenNewChatWithOpusAndReportSessionId', async () => {
    const folder = tempDir();
    const sessions = [];
    const { jobs, calls } = jobsWith([{ result: 'ok', is_error: false, session_id: '11111111-2222-3333-4444-555555555555' }, { result: 'ok', is_error: false, session_id: '66666666-7777-8888-9999-000000000000' }]);
    jobs.order('rode os testes', folder, { sessionId: '11111111-2222-3333-4444-555555555555', onSession: (id) => sessions.push(id) });
    await settle();
    jobs.order('novo chat, crie um README', folder, { onSession: (id) => sessions.push(id) });
    await settle();
    assert.deepEqual(calls[0].args.slice(0, 7), resumeOrderArgs('11111111-2222-3333-4444-555555555555'));
    assert.deepEqual(calls[1].args.slice(0, NEW_ORDER_ARGS.length), [...NEW_ORDER_ARGS]);
    assert.equal(calls[1].input, 'crie um README');
    assert.equal(calls[0].options.cwd, folder);
    assert.deepEqual(sessions, ['11111111-2222-3333-4444-555555555555', '66666666-7777-8888-9999-000000000000']);
    assert.throws(() => resumeOrderArgs('--dangerously-skip-permissions'), (error) => error.code === 'invalid_session_id');
});

test('shouldOpenNewChatWhenBoundChatNoLongerExists', async () => {
    const folder = tempDir();
    const sessions = [];
    const { jobs, calls } = jobsWith([{ result: 'No conversation found with session ID', is_error: true }, { result: 'feito\nRESUMO: feito', is_error: false, session_id: '66666666-7777-8888-9999-000000000000' }]);
    jobs.order('rode os testes', folder, { sessionId: '11111111-2222-3333-4444-555555555555', onSession: (id) => sessions.push(id) });
    await settle();
    assert.equal(calls.length, 2);
    assert.ok(calls[1].args.includes('opus'));
    assert.deepEqual(sessions, ['66666666-7777-8888-9999-000000000000']);
});

test('shouldKeepChatBoundForThreeHoursAndReleaseOnDemand', () => {
    let now = 10_000_000;
    const chats = createClaudeChats({ filePath: path.join(tempDir(), 'chats.json'), clock: () => now });
    assert.equal(chats.activeCurrent(), undefined);
    chats.remember('C:\\Projeto', '11111111-2222-3333-4444-555555555555');
    assert.equal(chats.activeCurrent().sessionId, '11111111-2222-3333-4444-555555555555');
    now += BINDING_WINDOW_MS - 1;
    assert.ok(chats.activeCurrent(), 'ainda dentro das 3 h');
    now += 2;
    assert.equal(chats.activeCurrent(), undefined, 'passaram 3 h');
    assert.equal(chats.previousFor('c:\\projeto').sessionId, '11111111-2222-3333-4444-555555555555', 'o chat anterior continua lembrado');
    chats.remember('C:\\Projeto', '11111111-2222-3333-4444-555555555555');
    chats.release();
    assert.equal(chats.activeCurrent(), undefined);
    chats.remember('C:\\Projeto', 'nao-e-um-id');
    assert.equal(chats.activeCurrent(), undefined, 'id inválido é ignorado');
});

test('shouldRefuseOrderWithoutProjectFolder', () => {
    const { jobs } = jobsWith([]);
    assert.throws(() => jobs.order('x', undefined), (error) => error.code === 'no_project_folder');
    assert.throws(() => jobs.order('x', 'C:\\nao\\existe'), (error) => error.code === 'no_project_folder');
});

// ---------- ações internas ----------
function runnerWith({
    lockStatus = LockStatus.OK, answer = { state: JobState.NONE }, folder = { status: 'ok', folder: 'C:\\P', order: 'rode os testes' },
    active, previous,
} = {}) {
    const remembered = [];
    const asked = [];
    const ordered = [];
    const notices = [];
    let revoked = false;
    const runner = createInternalRunner({
        inputHelper: { run: async () => 'ok' },
        loadPrograms: () => ({ programs: [] }),
        launcher: { openApp: async () => true, openUrl: async () => true },
        claudeJobs: {
            ask: (text) => asked.push(text),
            order: (text, where, chat = {}) => ordered.push([text, where, chat.sessionId]),
            lastAnswer: () => answer,
            isNewChatRequest: (text) => /^novo chat/.test(text),
        },
        claudeFolders: { resolve: (ordem) => (folder.status === 'ok' ? { ...folder, order: ordem } : folder) },
        claudeChats: {
            activeCurrent: () => active,
            previousFor: () => previous,
            isActive: (binding) => binding === active,
            remember: (where, id) => remembered.push([where, id]),
            release: () => remembered.push('release'),
        },
        sessionLock: { check: () => lockStatus, revoke: () => { revoked = true; } },
        notify: (text) => notices.push(text),
        logger: QUIET_LOGGER,
    });
    return { runner, asked, ordered, notices, remembered, wasRevoked: () => revoked };
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
    assert.deepEqual(open.ordered, [['rode os testes', 'C:\\P', undefined]], 'sem chat anterior: chat novo');
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

test('shouldSendEveryOrderToTheBoundChatForThreeHours', async () => {
    const bound = { folder: 'C:\\Bound', sessionId: '11111111-2222-3333-4444-555555555555' };
    const { runner, ordered } = runnerWith({ active: bound, previous: bound });
    assert.deepEqual(await runner.run('claude_code_ordem', { ordem: 'agora rode os testes' }), { ok: true });
    assert.deepEqual(ordered, [['agora rode os testes', 'C:\\Bound', '11111111-2222-3333-4444-555555555555']], 'vai para o chat vinculado, mesmo sem dizer o projeto');
});

test('shouldAskContinueOrNewAfterThreeHoursAndHonorTheAnswer', async () => {
    const old = { folder: 'C:\\P', sessionId: '11111111-2222-3333-4444-555555555555' };
    assert.deepEqual(await runnerWith({ previous: old }).runner.run('claude_code_ordem', { ordem: 'rode os testes' }), { ok: false, status: 'chat_choice' });
    const keep = runnerWith({ previous: old });
    await keep.runner.run('claude_code_ordem', { ordem: 'rode os testes', chat: 'continuar' });
    assert.equal(keep.ordered[0][2], '11111111-2222-3333-4444-555555555555');
    const fresh = runnerWith({ previous: old });
    await fresh.runner.run('claude_code_ordem', { ordem: 'rode os testes', chat: 'novo' });
    assert.equal(fresh.ordered[0][2], undefined);
    const forced = runnerWith({ previous: old });
    await forced.runner.run('claude_code_ordem', { ordem: 'novo chat, rode os testes' });
    assert.equal(forced.ordered[0][2], undefined, '"novo chat" não pergunta');
});

test('shouldReleaseBindingWhenSessionEnds', async () => {
    const end = runnerWith();
    await end.runner.run('claude_code_encerrar', {});
    assert.deepEqual(end.remembered, ['release']);
});
