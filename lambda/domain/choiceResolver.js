'use strict';
/*
 * Resposta à pergunta "Encontrei X e Y. Qual deles?": "o primeiro", "a segunda", "número 2", "opção três"
 * ou o próprio nome (aproximado). Só escolhe ENTRE as opções que o PC devolveu.
 */
const ORDINALS = Object.freeze([
    ['primeiro', 'primeira', 'um', 'uma', '1'],
    ['segundo', 'segunda', 'dois', 'duas', '2'],
    ['terceiro', 'terceira', 'tres', '3'],
]);
const MIN_PARTIAL_LENGTH = 3;
const FILLER_WORDS = /\b(o|a|os|as|opcao|numero|esse|essa|este|esta|quero|abrir|abre|fechar|fecha)\b/g;

function normalize(value) {
    return String(value || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function ordinalIndex(text) {
    const words = text.split(' ');
    return ORDINALS.findIndex((forms) => forms.some((form) => words.includes(form)));
}

/**
 * @param {string[]} choices  opções que o PC devolveu (até 3)
 * @param {string} spoken     o que a pessoa respondeu
 * @returns {string|undefined} a opção escolhida
 */
function pickChoice(choices, spoken) {
    const text = normalize(spoken);
    if (!text || !Array.isArray(choices) || choices.length === 0) return undefined;
    const index = ordinalIndex(text);
    if (index >= 0) return choices[index];
    const wanted = normalize(text.replace(FILLER_WORDS, ' '));
    if (!wanted) return undefined;
    const exact = choices.find((choice) => normalize(choice) === wanted);
    if (exact) return exact;
    // Trechos curtos demais ("a", "tv") casariam com quase tudo: exigem 3+ letras.
    const isLongEnough = (value) => value.length >= MIN_PARTIAL_LENGTH;
    const containing = choices.filter((choice) => {
        const name = normalize(choice);
        return (isLongEnough(wanted) && name.includes(wanted)) || (isLongEnough(name) && wanted.includes(name));
    });
    return containing.length === 1 ? containing[0] : undefined;
}

module.exports = { pickChoice };
