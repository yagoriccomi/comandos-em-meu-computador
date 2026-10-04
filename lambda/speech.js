'use strict';
/* Todas as frases faladas pela skill. A Alexa nunca fala detalhe técnico ou mensagem de erro. */
const SECONDS_PER_HOUR = 3600;

/** Nomes vindos do PC entram no SSML: escapar evita quebrar a fala (ex.: "AT&T"). */
function escapeSsml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** ["A", "B", "C"] → "A, B e C" (já escapado). */
function joinNames(names, conjunction) {
    const escaped = names.map(escapeSsml);
    return escaped.length <= 1 ? escaped.join('') : `${escaped.slice(0, -1).join(', ')} ${conjunction} ${escaped[escaped.length - 1]}`;
}

const ASK_BY_NAME = Object.freeze({
    consulta: 'O que você quer pesquisar?',
    programa: 'Qual programa?',
});

function formatSeconds(totalSeconds) {
    if (totalSeconds >= SECONDS_PER_HOUR && totalSeconds % SECONDS_PER_HOUR === 0) {
        const hours = totalSeconds / SECONDS_PER_HOUR;
        return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }
    return `${totalSeconds} ${totalSeconds === 1 ? 'segundo' : 'segundos'}`;
}

const ASK_BY_TYPE = Object.freeze({
    duration: () => 'Quanto tempo? Diga, por exemplo: 30 segundos ou 2 minutos.',
    text: (param) => ASK_BY_NAME[param.name] || 'Pode repetir, por favor?',
    integer: (param) => `Em quantos ${param.unit || param.name}? Diga, por exemplo: 30 ${param.unit || param.name}.`,
});

const INVALID_BY_TYPE = Object.freeze({
    duration: (param) => `O tempo precisa ser de ${formatSeconds(param.min)} a ${formatSeconds(param.max)}.`,
    text: () => 'Não consegui entender o que pesquisar. Tente uma frase mais curta.',
    integer: (param) => `O valor precisa ser de ${param.min} a ${param.max} ${param.unit || param.name}.`,
});

module.exports = Object.freeze({
    WELCOME: 'O monstro está pronto. O que você quer que eu faça?',
    WELCOME_REPROMPT: 'Você pode dizer, por exemplo: abrir a Netflix.',
    HELP: 'Você pode dizer, por exemplo: pausar o vídeo, aumentar o volume, avançar 30 segundos, abrir o Discord, pesquisar no Google, ou desligar o computador em 30 minutos. O que você quer?',
    DONE: 'Feito.',
    FAILED: 'Não consegui executar essa ação.',
    UNKNOWN_ACTION: 'Não conheço essa ação.',
    CANCELLED_BY_USER: 'Tudo bem, não fiz nada.',
    GOODBYE: 'Até mais.',
    CONFIRMATION_EXPIRED: 'Demorou demais para confirmar. Peça de novo, por favor.',
    PROGRAM_NOT_FOUND: 'Não achei esse programa no computador.',
    CHOICE_NOT_UNDERSTOOD: 'Não entendi qual deles. Peça de novo, por favor.',
    whichOne: (choices) => `Encontrei ${joinNames(choices, 'e')}. Qual deles?`,
    didYouMean: (choices) => `Não achei esse programa. Você quis dizer ${joinNames(choices, 'ou')}?`,
    askForParam: (param) => (ASK_BY_TYPE[param.type] || ASK_BY_TYPE.integer)(param),
    invalidParam: (param) => (INVALID_BY_TYPE[param.type] || INVALID_BY_TYPE.integer)(param),
    confirmAction: (action, params) => {
        const details = Object.entries(params).map(([name, value]) => ` em ${value} ${name}`).join('');
        return `Você confirma ${action.spokenName}${details}?`;
    },
});
