'use strict';
/*
 * Converte o intent reconhecido pela Alexa em { action, params } do catálogo fechado.
 * O que sai daqui: o id do catálogo e parâmetros validados pelo tipo declarado
 * (inteiro na faixa, duração em segundos, texto curto sem caracteres de controle, verbo canônico).
 *
 * Programas: o nome falado vai como TEXTO para o PC, que procura na lista privada (a Lambda não conhece
 * os programas do dono). Frase que não é ação conhecida ("alterna para a TV") também vai para o PC.
 */
const { ParamType, VERB_PATTERN } = require('./catalog');
const { isValidTextParam } = require('../protocol/message');
const { detectClaudePhrase } = require('./claudePhrase');

const ENTITY_MATCH = 'ER_SUCCESS_MATCH';
const DIGITS_ONLY = /^\d{1,6}$/;
// Só horas, minutos e segundos inteiros: "PT1M30S", "PT90S", "PT2H". Dias, semanas e frações são recusados.
const ISO_DURATION = /^PT(?:(\d{1,3})H)?(?:(\d{1,4})M)?(?:(\d{1,5})S)?$/;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const FREE_PHRASE_ACTION_ID = 'abrir_programa';
/** Grupo do verbo falado → ação. "Feche o Edge" cai no mesmo intent de "abra o Edge"; o verbo decide. */
const PROGRAM_ACTION_BY_VERB_GROUP = Object.freeze({ abrir: 'abrir_programa', fechar: 'fechar_programa', destravar: 'destravar_programa' });
const OPEN_VERB_GROUP = 'abrir';
const ANY_VERB = '*';

const ResolutionFailure = Object.freeze({
    UNKNOWN_ACTION: 'unknown_action',
    MISSING_PARAM: 'missing_param',
    INVALID_PARAM: 'invalid_param',
});

/** Intents genéricos: o slot diz qual ação do catálogo é. */
const SLOT_INTENTS = Object.freeze({
    AbrirAplicativoIntent: { slotName: 'aplicativo', slotType: 'TIPO_APLICATIVO' },
    ExecutarRotinaIntent: { slotName: 'rotina', slotType: 'TIPO_ROTINA' },
});

function findMatchedEntityId(slot) {
    const authorities = (slot && slot.resolutions && slot.resolutions.resolutionsPerAuthority) || [];
    const match = authorities.find((authority) => authority.status && authority.status.code === ENTITY_MATCH);
    const firstValue = match && match.values && match.values[0] && match.values[0].value;
    return firstValue ? firstValue.id : undefined;
}

function parseIsoDurationSeconds(value) {
    const match = ISO_DURATION.exec(String(value));
    if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
    const [hours, minutes, seconds] = match.slice(1).map((part) => Number(part || 0));
    return hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds;
}

function isEmpty(value) {
    return value === undefined || value === null || value === '';
}

function parseText(param, rawValue) {
    const text = String(rawValue).trim();
    return isValidTextParam(text) && text.length <= param.maxLength ? { ok: true, value: text } : { ok: false };
}

/** Verbo: id canônico do slot de verbos (ex.: "abre" → "abrir"). */
function parseVerb(slot) {
    const canonical = findMatchedEntityId(slot) || String(slot.value).trim().toLowerCase();
    return VERB_PATTERN.test(canonical) ? { ok: true, value: canonical } : { ok: false };
}

/** @returns {{ ok: true, value: number|string } | { ok: false }} */
function parseParamValue(param, slot) {
    if (param.type === ParamType.VERB) return parseVerb(slot);
    if (param.type === ParamType.TEXT) return parseText(param, slot.value);
    const rawValue = String(slot.value);
    const value = param.type === ParamType.DURATION
        ? parseIsoDurationSeconds(rawValue)
        : (DIGITS_ONLY.test(rawValue) ? Number.parseInt(rawValue, 10) : undefined);
    if (value === undefined || value < param.min || value > param.max) return { ok: false };
    return { ok: true, value };
}

function resolveParams(action, intent) {
    const params = {};
    for (const param of action.params) {
        const slot = intent.slots && intent.slots[param.slot];
        if (!slot || isEmpty(slot.value)) {
            if (param.default !== undefined) {
                params[param.name] = param.default;
                continue;
            }
            if (param.optional) continue;
            return { ok: false, reason: ResolutionFailure.MISSING_PARAM, action, missingSlot: param.slot };
        }
        const parsed = parseParamValue(param, slot);
        if (!parsed.ok) {
            // Verbo estranho não impede a ação: vale o verbo padrão dela.
            if (param.type === ParamType.VERB && param.default !== undefined) {
                params[param.name] = param.default;
                continue;
            }
            return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action, param };
        }
        params[param.name] = parsed.value;
    }
    return { ok: true, action, params };
}

/** "Pede para o monstro alterna para a TV": a frase inteira vai para o PC procurar entre nomes e apelidos. */
function resolveFreePhrase(slot, catalog) {
    const action = catalog.findById(FREE_PHRASE_ACTION_ID);
    const programParam = action && action.params.find((param) => param.type === ParamType.TEXT);
    if (!programParam || !slot || isEmpty(slot.value)) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    const parsed = parseText(programParam, slot.value);
    if (!parsed.ok) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    return { ok: true, action, params: { programa: parsed.value, verbo: ANY_VERB, exato: 0 } };
}

function verbGroupOf(intent, catalog) {
    const verbSlot = intent.slots && intent.slots.verbo;
    const verb = verbSlot && findMatchedEntityId(verbSlot);
    if (!verb) return OPEN_VERB_GROUP;
    const group = Object.keys(catalog.verbs).find((name) => Object.prototype.hasOwnProperty.call(catalog.verbs[name], verb));
    return group || OPEN_VERB_GROUP;
}

/** Frase inteira de um intent genérico (verbo + nome, ou frase livre), para checar se era um pedido ao Claude. */
function spokenSentence(intent) {
    const slots = intent.slots || {};
    return [slots.verbo, slots.aplicativo, slots.rotina].filter((slot) => slot && !isEmpty(slot.value)).map((slot) => slot.value).join(' ');
}

/** "mandar o Claude Code …" / "perguntar ao Claude …" que caiu num intent genérico vira o pedido certo. */
function resolveMisroutedClaudePhrase(intent, catalog) {
    const detected = detectClaudePhrase(spokenSentence(intent));
    const action = detected && catalog.findById(detected.actionId);
    if (!action) return undefined;
    const textParam = action.params.find((param) => param.type === ParamType.TEXT && !param.optional);
    const parsed = parseText(textParam, detected.text);
    return parsed.ok ? { ok: true, action, params: { [textParam.name]: parsed.value } } : undefined;
}

function resolveIntent(intent, catalog) {
    if (!intent || typeof intent.name !== 'string') return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    const slotIntent = SLOT_INTENTS[intent.name];
    if (slotIntent) {
        const misrouted = resolveMisroutedClaudePhrase(intent, catalog);
        if (misrouted) return misrouted;
        const slot = intent.slots && intent.slots[slotIntent.slotName];
        const catalogAction = catalog.findById(findMatchedEntityId(slot));
        if (intent.name === 'ExecutarRotinaIntent') {
            if (catalogAction && catalogAction.slotType === slotIntent.slotType) return resolveParams(catalogAction, intent);
            return resolveFreePhrase(slot, catalog);
        }
        const group = verbGroupOf(intent, catalog);
        // "Abrir a Netflix" é ação do catálogo; "fechar a Netflix" vai para o PC procurar um programa.
        if (group === OPEN_VERB_GROUP && catalogAction && catalogAction.slotType === slotIntent.slotType) return resolveParams(catalogAction, intent);
        const programAction = catalog.findById(PROGRAM_ACTION_BY_VERB_GROUP[group]);
        return programAction ? resolveParams(programAction, intent) : { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    }
    const action = catalog.findByIntent(intent.name);
    if (!action) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    return resolveParams(action, intent);
}

/** Revalida um valor já resolvido (vindo da sessão) contra o tipo declarado. */
function isValidResolvedValue(param, value) {
    if (param.type === ParamType.VERB) return typeof value === 'string' && VERB_PATTERN.test(value);
    if (param.type === ParamType.TEXT) return isValidTextParam(value) && value.length <= param.maxLength;
    return Number.isSafeInteger(value) && value >= param.min && value <= param.max;
}

/** Parâmetros guardados na sessão: exatamente os declarados e válidos para o tipo. */
function revalidateParams(action, params) {
    const values = params && typeof params === 'object' ? params : {};
    const declaredNames = new Set(action.params.map((param) => param.name));
    if (Object.keys(values).some((name) => !declaredNames.has(name))) return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action };
    for (const param of action.params) {
        const present = Object.prototype.hasOwnProperty.call(values, param.name);
        if (!present && param.optional) continue;
        if (!present || !isValidResolvedValue(param, values[param.name])) return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action, param };
    }
    return { ok: true, action, params: { ...values } };
}

/**
 * Revalida uma ação guardada na sessão à espera de confirmação: o id precisa existir no catálogo e exigir
 * confirmação, e os parâmetros precisam ser exatamente os declarados e válidos para o tipo.
 */
function resolvePendingAction(pending, catalog) {
    const action = pending && catalog.findById(pending.actionId);
    if (!action || !action.requiresConfirmation) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    return revalidateParams(action, pending.params);
}

module.exports = {
    ResolutionFailure,
    SLOT_INTENTS,
    ANY_VERB,
    findMatchedEntityId,
    parseIsoDurationSeconds,
    resolveIntent,
    resolvePendingAction,
    revalidateParams,
    isActionIntent: (intentName) => Boolean(SLOT_INTENTS[intentName]),
};
