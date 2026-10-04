'use strict';
/* Ids do catálogo público executados por código fixo do agente (sem executável no actions.json). */
const INTERNAL_ACTION_IDS = Object.freeze([
    'pausar_continuar',
    'alternar_mudo',
    'tela_cheia',
    'sair_tela_cheia',
    'pular',
    'aumentar_volume',
    'abaixar_volume',
    'avancar_tempo',
    'voltar_tempo',
    'pesquisar_google',
    'abrir_programa',
    'fechar_programa',
    'destravar_programa',
]);

module.exports = { INTERNAL_ACTION_IDS };
