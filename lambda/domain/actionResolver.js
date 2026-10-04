'use strict';
/*
 * Converte o intent reconhecido pela Alexa em { action, params } do catálogo fechado.
 * O que sai daqui: o id do catálogo e parâmetros validados pelo tipo declarado
 * (inteiro na faixa, duração em segundos, texto curto sem caracteres de controle, id de programa).
 */
const { ParamType, PROGRAM_ID_PATTERN } = require('./catalog');
const { isValidTextParam } = require('../protocol/message');

const ENTITY_MATCH = 'ER_SUCCESS_MATCH';
const DIGITS_ONLY = /^\d{1,6}$/;
// Só horas, minutos e segundos inteiros: "PT1M30S", "PT90S", "PT2H". Dias, semanas e frações são recusados.
const ISO_DURATION = /^PT(?:(\d{1,3})H)?(?:(\d{1,4})M)?(?:(\d{1,5})S)?$/;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

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

function isProgramId(value) {
    return typeof value === 'string' && PROGRAM_ID_PATTERN.test(value);
}

/**
 * Valor do slot de aplicativo que é um programa da lista privada do PC: a ação é a do intent
 * (abrir/fechar/destravar programa), e não uma entrada do catálogo.
 */
function resolveActionFromSlot(intent, slotIntent, catalog) {
    const slot = intent.slots && intent.slots[slotIntent.slotName];
    const entityId = findMatchedEntityId(slot);
    if (isProgramId(entityId)) return catalog.findByIntent(intent.name);
    const action = catalog.findById(entityId);
    if (!action || action.slotType !== slotIntent.slotType) return undefined;
    return action;
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

/** @returns {{ ok: true, value: number|string } | { ok: false }} */
function parseParamValue(param, slot) {
    if (param.type === ParamType.PROGRAM) {
        const entityId = findMatchedEntityId(slot);
        return isProgramId(entityId) ? { ok: true, value: entityId } : { ok: false };
    }
    const rawValue = String(slot.value);
    if (param.type === ParamType.TEXT) {
        const text = rawValue.trim();
        return isValidTextParam(text) && text.length <= param.maxLength ? { ok: true, value: text } : { ok: false };
    }
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
            // Programa sem nome reconhecido vira "não conheço"; os outros parâmetros são perguntados.
            if (param.type === ParamType.PROGRAM) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
            return { ok: false, reason: ResolutionFailure.MISSING_PARAM, action, missingSlot: param.slot };
        }
        const parsed = parseParamValue(param, slot);
        if (!parsed.ok) {
            if (param.type === ParamType.PROGRAM) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
            return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action, param };
        }
        params[param.name] = parsed.value;
    }
    return { ok: true, action, params };
}

function resolveIntent(intent, catalog) {
    if (!intent || typeof intent.name !== 'string') return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    const slotIntent = SLOT_INTENTS[intent.name];
    const action = slotIntent ? resolveActionFromSlot(intent, slotIntent, catalog) : catalog.findByIntent(intent.name);
    if (!action) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    return resolveParams(action, intent);
}

/** Revalida um valor já resolvido (vindo da sessão) contra o tipo declarado. */
function isValidResolvedValue(param, value) {
    if (param.type === ParamType.PROGRAM) return isProgramId(value);
    if (param.type === ParamType.TEXT) return isValidTextParam(value) && value.length <= param.maxLength;
    return Number.isSafeInteger(value) && value >= param.min && value <= param.max;
}

/**
 * Revalida uma ação guardada na sessão à espera de confirmação: o id precisa existir no catálogo e exigir
 * confirmação, e os parâmetros precisam ser exatamente os declarados e válidos para o tipo.
 */
function resolvePendingAction(pending, catalog) {
    const action = pending && catalog.findById(pending.actionId);
    if (!action || !action.requiresConfirmation) return { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION };
    const params = pending.params && typeof pending.params === 'object' ? pending.params : {};
    const declaredNames = action.params.map((param) => param.name).sort();
    if (JSON.stringify(Object.keys(params).sort()) !== JSON.stringify(declaredNames)) {
        return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action };
    }
    for (const param of action.params) {
        if (!isValidResolvedValue(param, params[param.name])) {
            return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action, param };
        }
    }
    return { ok: true, action, params: { ...params } };
}

module.exports = {
    ResolutionFailure,
    SLOT_INTENTS,
    parseIsoDurationSeconds,
    resolveIntent,
    resolvePendingAction,
    isActionIntent: (intentName) => Boolean(SLOT_INTENTS[intentName]),
};
