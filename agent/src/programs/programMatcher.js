'use strict';
/*
 * Acha o programa que a pessoa falou na lista PRIVADA do PC. O texto falado só é comparado, nunca executado.
 *
 * Pontuação (0–100) do melhor nome ou apelido de cada programa:
 *   100 igual (com ou sem espaços: "pp ssp p" = "ppsspp")
 *   ~90 as palavras faladas são o começo das palavras do nome, na ordem ("epic" → "Epic Games Launcher")
 *    85 começo do nome sem espaços ("cloudfl" → "Cloudflare WARP")
 *    75 trecho do nome (4+ letras)
 *   <80 parecido, com pequenos erros ("ppspp" → "PPSSPP")
 * Vencedor claro executa; empate técnico vira pergunta ("qual deles?"); nada bom vira "parecidos".
 */
const { normalizeText, compactText, similarity } = require('./textNormalization');

const MatchStatus = Object.freeze({ OK: 'ok', AMBIGUOUS: 'ambiguous', NOT_FOUND: 'not_found' });

const ACCEPT_SCORE = 60;
const AMBIGUITY_MARGIN = 8;
const SUGGESTION_SCORE = 35;
const MAX_CHOICES = 3;
const MIN_PREFIX_LENGTH = 3;
const MIN_SUBSTRING_LENGTH = 4;
const TYPO_SIMILARITY = 0.7;
const PREFIX_TYPO_SIMILARITY = 0.8;
const LENGTH_PENALTY_PER_EXTRA_WORD = 2;
const MAX_LENGTH_PENALTY = 12;
/** Verbo das frases livres ("alterna para a TV"): não filtra por verbo. */
const ANY_VERB = '*';

function wordsArePrefixesInOrder(queryWords, candidateWords) {
    let position = 0;
    for (const word of queryWords) {
        while (position < candidateWords.length && !candidateWords[position].startsWith(word)) position += 1;
        if (position === candidateWords.length) return false;
        position += 1;
    }
    return true;
}

function scoreCandidate(query, candidate) {
    const queryText = normalizeText(query);
    const candidateText = normalizeText(candidate);
    const queryCompact = compactText(query);
    const candidateCompact = compactText(candidate);
    if (!queryCompact || !candidateCompact) return 0;
    if (queryText === candidateText || queryCompact === candidateCompact) return 100;

    const queryWords = queryText.split(' ');
    const candidateWords = candidateText.split(' ');
    const scores = [];
    if (wordsArePrefixesInOrder(queryWords, candidateWords)) {
        // Nomes mais curtos ganham: "cloudflare" prefere "Cloudflare WARP" a "Cloudflare WARP Diagnostics".
        scores.push(92 - Math.min((candidateWords.length - queryWords.length) * LENGTH_PENALTY_PER_EXTRA_WORD, MAX_LENGTH_PENALTY));
    }
    if (queryCompact.length >= MIN_PREFIX_LENGTH && candidateCompact.startsWith(queryCompact)) scores.push(85);
    if (queryCompact.length >= MIN_SUBSTRING_LENGTH && candidateCompact.includes(queryCompact)) scores.push(75);
    const whole = similarity(queryCompact, candidateCompact);
    if (whole >= TYPO_SIMILARITY) scores.push(Math.round(whole * 80));
    if (queryCompact.length >= MIN_PREFIX_LENGTH && candidateCompact.length > queryCompact.length) {
        const prefix = similarity(queryCompact, candidateCompact.slice(0, queryCompact.length));
        if (prefix >= PREFIX_TYPO_SIMILARITY) scores.push(Math.round(prefix * 72));
    }
    return scores.length ? Math.max(...scores) : Math.round(whole * 40);
}

function isAllowedVerb(program, verb) {
    return verb === ANY_VERB || !program.disabledVerbs.includes(verb);
}

function namesOf(program) {
    return [program.name, ...program.aliases];
}

/**
 * @param {string} spoken     o que a Alexa ouviu (ex.: "epic")
 * @param {object[]} programs  programas da lista ({ name, aliases, disabledVerbs, active, … })
 * @param {{ verb: string, exact?: boolean }} options  exact = resposta da pergunta "qual deles?" (nome exato)
 * @returns {{ status: string, program?: object, choices?: string[] }}
 */
function matchProgram(spoken, programs, { verb, exact = false }) {
    const eligible = programs.filter((program) => program.active && isAllowedVerb(program, verb));
    if (exact) {
        const wanted = normalizeText(spoken);
        const found = eligible.find((program) => namesOf(program).some((name) => normalizeText(name) === wanted));
        if (found) return { status: MatchStatus.OK, program: found };
    }
    const ranked = eligible
        .map((program) => ({ program, score: Math.max(...namesOf(program).map((name) => scoreCandidate(spoken, name))) }))
        .sort((left, right) => right.score - left.score || left.program.name.length - right.program.name.length);
    const [best] = ranked;
    if (!best || best.score < ACCEPT_SCORE) {
        const suggestions = ranked.filter((entry) => entry.score >= SUGGESTION_SCORE).slice(0, MAX_CHOICES);
        return { status: MatchStatus.NOT_FOUND, choices: suggestions.map((entry) => entry.program.name) };
    }
    const contenders = ranked.filter((entry) => entry.score >= ACCEPT_SCORE && best.score - entry.score < AMBIGUITY_MARGIN);
    if (contenders.length > 1 && best.score < 100) {
        return { status: MatchStatus.AMBIGUOUS, choices: contenders.slice(0, MAX_CHOICES).map((entry) => entry.program.name) };
    }
    return { status: MatchStatus.OK, program: best.program };
}

module.exports = { MatchStatus, ANY_VERB, scoreCandidate, matchProgram };
