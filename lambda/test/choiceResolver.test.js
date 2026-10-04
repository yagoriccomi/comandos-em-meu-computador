'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickChoice } = require('../domain/choiceResolver');

const CHOICES = ['Cloudflare WARP', 'Cloudflare One', 'Cloudflare Zero Trust'];

test('shouldPickByOrdinalInAnyForm', () => {
    for (const [spoken, expected] of [['o primeiro', 0], ['a segunda', 1], ['número três', 2], ['opção dois', 1], ['3', 2], ['primeira', 0]]) {
        assert.equal(pickChoice(CHOICES, spoken), CHOICES[expected], spoken);
    }
});

test('shouldPickByNameOrUniquePart', () => {
    assert.equal(pickChoice(CHOICES, 'cloudflare warp'), 'Cloudflare WARP');
    assert.equal(pickChoice(CHOICES, 'o zero trust'), 'Cloudflare Zero Trust');
});

test('shouldNotGuessWhenAnswerIsUnclear', () => {
    assert.equal(pickChoice(CHOICES, 'cloudflare'), undefined, 'serve para as três');
    assert.equal(pickChoice(CHOICES, 'banana'), undefined);
    assert.equal(pickChoice(CHOICES, ''), undefined);
    assert.equal(pickChoice(['A'], 'o quarto'), undefined);
});
