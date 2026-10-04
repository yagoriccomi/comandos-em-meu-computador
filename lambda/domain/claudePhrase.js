'use strict';
/*
 * Rede de segurança para frases do Claude que a Alexa encaixou no lugar errado. Exemplo: "mandar o Claude Code no
 * projeto X …" caía em "<verbo> <programa>" (o slot de verbo aceita qualquer palavra) e virava busca de programa.
 * Aqui reconhecemos a frase inteira, inclusive como a Alexa costuma transcrever "Claude" ("cloud", "clode",
 * "cláudio"…), e devolvemos o pedido certo: ordem ao Claude Code ou pergunta ao Claude.
 */
const CLAUDE = '(?:o |a )?(?:claude|claud|cloud|clod|clode|claudio|clau)';
const CODE = '(?:code|cold|cod|codi|coud|coude|cody)';
const SEND_VERBS = '(?:mandar|manda|mande|pedir|pede|peca|falar|fala|fale|dizer|diz|diga)';
const ASK_VERBS = '(?:perguntar|pergunta|pergunte)';
const TO = '(?:para |pra |pro |ao |a )?';

const ORDER_PATTERN = new RegExp(`^${SEND_VERBS}\\s+${TO}${CLAUDE}\\s+${CODE}\\b[\\s,:]*(.+)$`);
const QUESTION_PATTERN = new RegExp(`^${ASK_VERBS}\\s+${TO}${CLAUDE}\\b(?!\\s+${CODE}\\b)[\\s,:]*(.+)$`);

const ClaudePhraseKind = Object.freeze({ ORDER: 'claude_code_ordem', QUESTION: 'perguntar_claude' });

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} spoken  a frase inteira como a Alexa transcreveu
 * @returns {{ actionId: string, text: string } | undefined}  text = o resto da frase, com a grafia original
 */
function detectClaudePhrase(spoken) {
    const original = String(spoken || '').replace(/\s+/g, ' ').trim();
    const normalized = normalize(original);
    for (const [actionId, pattern] of [[ClaudePhraseKind.ORDER, ORDER_PATTERN], [ClaudePhraseKind.QUESTION, QUESTION_PATTERN]]) {
        const match = pattern.exec(normalized);
        if (!match) continue;
        // A normalização não muda a quantidade de palavras: o resto tem a mesma contagem na frase original.
        const restWords = match[1].trim().split(' ').length;
        const text = original.split(' ').slice(-restWords).join(' ').replace(/^[\s,:]+/, '');
        if (text) return { actionId, text };
    }
    return undefined;
}

module.exports = { ClaudePhraseKind, detectClaudePhrase };
