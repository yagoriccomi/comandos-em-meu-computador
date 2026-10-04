'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInternalRunner, searchUrl, volumePresses, speakableChoices } = require('../src/internal/internalActions');
const { INTERNAL_ACTION_IDS } = require('../src/internal/internalActionIds');
const { createLauncher } = require('../src/internal/launcher');
const { HelperVerb } = require('../src/desktop/inputHelper');

const QUIET_LOGGER = { info() {}, warn() {}, error() {} };

const DISCORD = {
    name: 'Discord', aliases: [], disabledVerbs: [], active: true, appId: 'com.squirrel.Discord.Discord',
    processes: [{ folder: 'C:\\Users\\x\\AppData\\Local\\Discord', exe: 'Discord.exe' }, { folder: 'C:\\Users\\x\\AppData\\Local\\Discord', exe: 'Update.exe' }],
};
const CLOUDFLARE = [
    { name: 'Cloudflare WARP', aliases: [], disabledVerbs: [], active: true, appId: 'warp', processes: [] },
    { name: 'Cloudflare One', aliases: [], disabledVerbs: [], active: true, appId: 'one', processes: [] },
];

function setup({ programs = [DISCORD], helperReply = () => 'ok' } = {}) {
    const helperCalls = [];
    const launched = [];
    const timers = [];
    const runner = createInternalRunner({
        inputHelper: { run: async (verb, argument) => { helperCalls.push([verb, argument]); return helperReply(verb, argument); } },
        loadPrograms: () => ({ programs }),
        launcher: { openApp: async (appId) => { launched.push(['app', appId]); return true; }, openUrl: async (url) => { launched.push(['url', url]); return true; } },
        logger: QUIET_LOGGER,
        setTimer: (callback) => timers.push(callback),
    });
    return { runner, helperCalls, launched, timers };
}

test('shouldHaveAHandlerForEveryInternalActionId', () => {
    const { runner } = setup();
    assert.deepEqual([...runner.actionIds].sort(), [...INTERNAL_ACTION_IDS].sort());
});

test('shouldMapMediaActionsToHelperVerbs', async () => {
    const { runner, helperCalls } = setup();
    await runner.run('pausar_continuar', {});
    await runner.run('aumentar_volume', { quantidade: 20 });
    await runner.run('abaixar_volume', { quantidade: 5 });
    await runner.run('voltar_tempo', { segundos: 180 });
    await runner.run('avancar_tempo', { segundos: 30 });
    await runner.run('pular', {});
    assert.deepEqual(helperCalls, [
        [HelperVerb.PLAY_PAUSE, undefined], [HelperVerb.VOLUME_UP, 10], [HelperVerb.VOLUME_DOWN, 3],
        [HelperVerb.SEEK, -180], [HelperVerb.SEEK, 30], [HelperVerb.SKIP, undefined],
    ]);
});

test('shouldReportFailureWhenHelperFails', async () => {
    const { runner } = setup({ helperReply: () => 'erro not_found' });
    assert.deepEqual(await runner.run('pular', {}), { ok: false });
});

test('shouldOpenOnlyEncodedGoogleSearchUrl', async () => {
    const { runner, launched } = setup();
    await runner.run('pesquisar_google', { consulta: 'pão & café" && del /q' });
    assert.deepEqual(launched, [['url', 'https://www.google.com/search?q=p%C3%A3o%20%26%20caf%C3%A9%22%20%26%26%20del%20%2Fq']]);
    assert.equal(searchUrl("it's (a)!*"), 'https://www.google.com/search?q=it%27s%20%28a%29%21%2A');
});

test('shouldOpenProgramFoundInPrivateList', async () => {
    const { runner, launched } = setup();
    assert.deepEqual(await runner.run('abrir_programa', { programa: 'discord', verbo: 'abrir', exato: 0 }), { ok: true });
    assert.deepEqual(launched, [['app', 'com.squirrel.Discord.Discord']]);
});

test('shouldReturnChoicesWhenProgramIsAmbiguousOrMissing', async () => {
    const { runner, launched } = setup({ programs: CLOUDFLARE });
    const ambiguous = await runner.run('abrir_programa', { programa: 'cloudflare', verbo: 'abrir', exato: 0 });
    assert.equal(ambiguous.status, 'ambiguous');
    assert.deepEqual([...ambiguous.choices].sort(), ['Cloudflare One', 'Cloudflare WARP']);
    const missing = await runner.run('abrir_programa', { programa: 'photoshop', verbo: 'abrir', exato: 0 });
    assert.equal(missing.status, 'not_found');
    assert.equal(launched.length, 0);
    const chosen = await runner.run('abrir_programa', { programa: 'Cloudflare One', verbo: 'abrir', exato: 1 });
    assert.deepEqual([chosen, launched], [{ ok: true }, [['app', 'one']]]);
});

test('shouldCloseEveryListedProcessAndForceOnlyWindowlessOnesLater', async () => {
    const { runner, helperCalls, timers } = setup();
    assert.deepEqual(await runner.run('fechar_programa', { programa: 'discord', verbo: 'fechar', exato: 0 }), { ok: true });
    assert.deepEqual(helperCalls.map(([verb, target]) => [verb, target.exe]), [[HelperVerb.CLOSE, 'Discord.exe'], [HelperVerb.CLOSE, 'Update.exe']]);
    timers.forEach((callback) => callback());
    assert.deepEqual(helperCalls.slice(2).map(([verb, target]) => [verb, target.exe]),
        [[HelperVerb.FORCE_WINDOWLESS, 'Discord.exe'], [HelperVerb.FORCE_WINDOWLESS, 'Update.exe']]);
});

test('shouldUnlockByKillingAllProcessesThenReopening', async () => {
    const { runner, helperCalls, launched } = setup();
    assert.deepEqual(await runner.run('destravar_programa', { programa: 'discord', verbo: 'destravar', exato: 0 }), { ok: true });
    assert.deepEqual(helperCalls.map(([verb]) => verb), [HelperVerb.KILL, HelperVerb.KILL]);
    assert.deepEqual(launched, [['app', 'com.squirrel.Discord.Discord']]);
});

test('shouldRefuseClosingProgramWithoutKnownProcesses', async () => {
    const { runner } = setup({ programs: CLOUDFLARE });
    assert.deepEqual(await runner.run('fechar_programa', { programa: 'Cloudflare One', verbo: 'fechar', exato: 1 }), { ok: false });
});

test('shouldKeepOnlySpeakableChoicesAndConvertVolume', () => {
    assert.deepEqual(speakableChoices(['A', 'B\nC', 'x'.repeat(80), 'D', 'E']), ['A', 'x'.repeat(60), 'D']);
    assert.equal(volumePresses(20), 10);
    assert.equal(volumePresses(1), 1);
});

test('shouldLaunchOnlyThroughExplorerWithSingleArgument', async () => {
    const spawned = [];
    const fakeChild = { once(event, callback) { if (event === 'spawn') callback(); }, unref() {} };
    const launcher = createLauncher({ spawn: (file, args, options) => { spawned.push([file, args, options.shell]); return fakeChild; }, logger: QUIET_LOGGER });
    assert.equal(await launcher.openApp('com.squirrel.Discord.Discord'), true);
    assert.equal(await launcher.openUrl('https://www.google.com/search?q=x'), true);
    assert.equal(await launcher.openUrl('file:///C:/Windows/System32/cmd.exe'), false);
    assert.equal(await launcher.openApp('x" & calc'), false);
    assert.deepEqual(spawned.map(([file, args, shell]) => [file.toLowerCase().endsWith('explorer.exe'), args, shell]), [
        [true, ['shell:AppsFolder\\com.squirrel.Discord.Discord'], false],
        [true, ['https://www.google.com/search?q=x'], false],
    ]);
});
