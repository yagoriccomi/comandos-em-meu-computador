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
    CLAUDE_STILL_THINKING: 'O Claude ainda está pensando. Peça a resposta de novo daqui a pouco.',
    CLAUDE_NO_ANSWER: 'Ainda não há resposta do Claude.',
    ASK_PIN: 'Para usar o Claude Code, diga o seu PIN, um número de cada vez.',
    PIN_NOT_UNDERSTOOD: 'Não entendi o PIN. Diga um número de cada vez, por exemplo: zero, meia, três.',
    PIN_WRONG: 'PIN incorreto. Diga de novo, um número de cada vez.',
    CLAUDE_CODE_LOCKED: 'O Claude Code está bloqueado por tentativas erradas. Tente de novo em quinze minutos.',
    VOICE_NOT_RECOGNIZED: 'Não reconheci a sua voz para usar o Claude Code.',
    /** Frase de sucesso específica de algumas ações (o resto diz "Feito."). */
    DONE_BY_ACTION: Object.freeze({
        perguntar_claude: 'Perguntei ao Claude. A resposta vai sair no computador.',
        claude_code_ordem: 'Enviei para o Claude Code. Quando ele terminar, o computador avisa.',
        claude_code_encerrar: 'Sessão do Claude Code encerrada.',
    }),
    /** Texto vindo do PC (resumo da resposta do Claude), escapado para o SSML. */
    pcText: (text) => escapeSsml(text),
    CHOICE_NOT_UNDERSTOOD: 'Não entendi qual deles. Peça de novo, por favor.',
    whichOne: (choices) => `Encontrei ${joinNames(choices, 'e')}. Qual deles?`,
    didYouMean: (choices, what = 'programa') => `Não achei esse ${what}. Você quis dizer ${joinNames(choices, 'ou')}?`,
    PROJECT_NOT_FOUND: 'Não achei esse projeto do Claude Code.',
    askForParam: (param) => (ASK_BY_TYPE[param.type] || ASK_BY_TYPE.integer)(param),
    invalidParam: (param) => (INVALID_BY_TYPE[param.type] || INVALID_BY_TYPE.integer)(param),
    confirmAction: (action, params) => {
        const details = Object.entries(params).map(([name, value]) => ` em ${value} ${name}`).join('');
        return `Você confirma ${action.spokenName}${details}?`;
    },
});
