'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSpokenPin } = require('../domain/pinParser');

test('shouldReadDigitsSpokenOneByOne', () => {
    assert.equal(parseSpokenPin('zero meia três um'), '0631');
    assert.equal(parseSpokenPin('Zero, Meia, Três, Um'), '0631');
    assert.equal(parseSpokenPin('o pin é sete oito zero nove dois'), '78092');
    assert.equal(parseSpokenPin('0 6 3 1'), '0631');
    assert.equal(parseSpokenPin('06318'), '06318');
    assert.equal(parseSpokenPin('uma duas seis'.concat(' quatro')), '1264');
});

test('shouldRefuseWrongLengthOrNumbersSpokenAsWholeWords', () => {
    assert.equal(parseSpokenPin('um dois três'), undefined, 'menos de 4');
    assert.equal(parseSpokenPin('1 2 3 4 5 6 7 8 9'), undefined, 'mais de 8');
    assert.equal(parseSpokenPin('seiscentos e trinta e um'), undefined, 'por extenso não vale');
    assert.equal(parseSpokenPin('banana'), undefined);
    assert.equal(parseSpokenPin(undefined), undefined);
});
