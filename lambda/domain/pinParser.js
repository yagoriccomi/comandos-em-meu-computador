'use strict';
/*
 * PIN falado dígito a dígito: "zero, meia, três, um" → "0631". Aceita palavras ("meia" = 6, como se fala em
 * telefone), dígitos soltos ("0 6 3 1") ou juntos ("0631"). Número por extenso ("seiscentos") NÃO vale:
 * a pessoa precisa repetir um dígito de cada vez.
 */
const MIN_PIN_DIGITS = 4;
const MAX_PIN_DIGITS = 8;

const DIGIT_WORDS = Object.freeze({
    zero: '0',
    um: '1', uma: '1',
    dois: '2', duas: '2',
    tres: '3',
    quatro: '4',
    cinco: '5',
    seis: '6', meia: '6',
    sete: '7',
    oito: '8',
    nove: '9',
});
const FILLER_WORDS = Object.freeze(new Set(['o', 'a', 'e', 'é', 'pin', 'meu', 'minha', 'senha', 'codigo', 'numero', 'eh']));

function normalize(value) {
    return String(value || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

/**
 * @param {string} spoken  o que a Alexa transcreveu
 * @returns {string|undefined} só os dígitos (4 a 8), ou undefined se algo não for dígito
 */
function parseSpokenPin(spoken) {
    const tokens = normalize(spoken).split(/[^a-z0-9]+/).filter(Boolean);
    let digits = '';
    for (const token of tokens) {
        if (/^\d+$/.test(token)) digits += token;
        else if (DIGIT_WORDS[token]) digits += DIGIT_WORDS[token];
        else if (!FILLER_WORDS.has(token)) return undefined;
    }
    return digits.length >= MIN_PIN_DIGITS && digits.length <= MAX_PIN_DIGITS ? digits : undefined;
}

module.exports = { MIN_PIN_DIGITS, MAX_PIN_DIGITS, parseSpokenPin };
