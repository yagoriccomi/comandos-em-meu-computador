'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchProgram, MatchStatus, ANY_VERB } = require('../src/programs/programMatcher');

function program(name, extra = {}) {
    return { name, aliases: [], disabledVerbs: [], active: true, ...extra };
}

const PROGRAMS = [
    program('Epic Games Launcher'),
    program('PPSSPP'),
    program('Cloudflare WARP'),
    program('Visual Studio Code', { aliases: ['vs code'] }),
    program('Claude', { aliases: ['cloud'] }),
    program('OpenClaude'),
    program('Discord'),
    program('Microsoft Edge', { aliases: ['edge'] }),
    program('Server Minecraft', { aliases: ['server de minecraft'] }),
    program('Minecraft'),
    program('Alternar para TV', { aliases: ['alterna para a tv'] }),
    program('Google Chrome'),
    program('Área de trabalho remota do Google Chrome'),
];

function open(spoken, options = {}) {
    return matchProgram(spoken, PROGRAMS, { verb: 'abrir', ...options });
}

function openedName(spoken) {
    const result = open(spoken);
    return result.status === MatchStatus.OK ? result.program.name : result.status;
}

test('shouldOpenByShortName', () => {
    assert.equal(openedName('epic'), 'Epic Games Launcher');
    assert.equal(openedName('cloudflare'), 'Cloudflare WARP');
});

test('shouldUnderstandSpelledOrMisspelledAcronyms', () => {
    for (const spoken of ['ppsspp', 'pp ssp p', 'p p s s p p', 'ppspp']) {
        assert.equal(openedName(spoken), 'PPSSPP', spoken);
    }
});

test('shouldUseAliasesAndIgnoreAccents', () => {
    assert.equal(openedName('vs code'), 'Visual Studio Code');
    assert.equal(openedName('cloud'), 'Claude');
    assert.equal(openedName('server de minecraft'), 'Server Minecraft');
    assert.equal(openedName('Minecraft'), 'Minecraft');
    assert.equal(openedName('area de trabalho remota do google chrome'), 'Área de trabalho remota do Google Chrome');
});

test('shouldPreferShorterNameWhenOneContainsTheOther', () => {
    assert.equal(openedName('google chrome'), 'Google Chrome');
    assert.equal(openedName('chrome'), 'Google Chrome');
});

test('shouldAskWhichOneWhenTwoProgramsAreEquallyLikely', () => {
    const programs = [program('Cloudflare WARP'), program('Cloudflare One')];
    const result = matchProgram('cloudflare', programs, { verb: 'abrir' });
    assert.equal(result.status, MatchStatus.AMBIGUOUS);
    assert.deepEqual([...result.choices].sort(), ['Cloudflare One', 'Cloudflare WARP']);
});

test('shouldPickExactNameAfterTheUserChooses', () => {
    const programs = [program('Cloudflare WARP'), program('Cloudflare One')];
    assert.equal(matchProgram('Cloudflare One', programs, { verb: 'abrir', exact: true }).program.name, 'Cloudflare One');
});

test('shouldSayNotFoundAndSuggestSimilar', () => {
    assert.equal(open('photoshop').status, MatchStatus.NOT_FOUND);
    const typo = matchProgram('discorde', [program('Discord')], { verb: 'abrir' });
    assert.equal(typo.status === MatchStatus.OK ? typo.program.name : typo.choices[0], 'Discord');
});

test('shouldIgnoreInactiveProgramsAndDisabledVerbs', () => {
    const programs = [program('Discord', { active: false }), program('Steam', { disabledVerbs: ['executar'] })];
    assert.equal(matchProgram('discord', programs, { verb: 'abrir' }).status, MatchStatus.NOT_FOUND);
    assert.equal(matchProgram('steam', programs, { verb: 'executar' }).status, MatchStatus.NOT_FOUND);
    assert.equal(matchProgram('steam', programs, { verb: 'abrir' }).program.name, 'Steam');
});

test('shouldMatchFreePhraseAliasesWithAnyVerb', () => {
    assert.equal(matchProgram('alterna para a tv', PROGRAMS, { verb: ANY_VERB }).program.name, 'Alternar para TV');
});
