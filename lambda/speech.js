'use strict';
/* Todas as frases faladas pela skill. A Alexa nunca fala detalhe técnico ou mensagem de erro. */
module.exports = Object.freeze({
    WELCOME: 'O monstro está pronto. O que você quer que eu faça?',
    WELCOME_REPROMPT: 'Você pode dizer, por exemplo: abrir a Netflix.',
    HELP: 'Você pode dizer, por exemplo: abrir a Netflix, desligar o computador em 30 minutos, bloquear a tela ou rodar o backup. O que você quer?',
    DONE: 'Feito.',
    FAILED: 'Não consegui executar essa ação.',
    UNKNOWN_ACTION: 'Não conheço essa ação.',
    CANCELLED_BY_USER: 'Tudo bem, não fiz nada.',
    GOODBYE: 'Até mais.',
    CONFIRMATION_EXPIRED: 'Demorou demais para confirmar. Peça de novo, por favor.',
    askForParam: (param) => `Em quantos ${param.name}? Diga, por exemplo: 30 ${param.name}.`,
    invalidParam: (param) => `O valor precisa ser de ${param.min} a ${param.max} ${param.name}.`,
    confirmAction: (action, params) => {
        const details = Object.entries(params).map(([name, value]) => ` em ${value} ${name}`).join('');
        return `Você confirma ${action.spokenName}${details}?`;
    },
});
