'use strict';
/*
 * Converte o intent reconhecido pela Alexa em { action, params } do catálogo fechado.
 * Nenhum texto falado sai daqui: apenas o id do catálogo e parâmetros inteiros validados.
 */
const ENTITY_MATCH = 'ER_SUCCESS_MATCH';
const DIGITS_ONLY = /^\d{1,6}$/;

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

function resolveActionFromSlot(intent, slotIntent, catalog) {
    const slot = intent.slots && intent.slots[slotIntent.slotName];
    const action = catalog.findById(findMatchedEntityId(slot));
    if (!action || action.slotType !== slotIntent.slotType) return undefined;
    return action;
}

function resolveParams(action, intent) {
    const params = {};
    for (const param of action.params) {
        const slot = intent.slots && intent.slots[param.slot];
        const rawValue = slot && slot.value;
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return { ok: false, reason: ResolutionFailure.MISSING_PARAM, action, missingSlot: param.slot };
        }
        if (!DIGITS_ONLY.test(String(rawValue))) {
            return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action, param };
        }
        const value = Number.parseInt(rawValue, 10);
        if (value < param.min || value > param.max) {
            return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action, param };
        }
        params[param.name] = value;
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

/**
 * Revalida uma ação guardada na sessão à espera de confirmação: o id precisa existir no catálogo e exigir
 * confirmação, e os parâmetros precisam ser exatamente os declarados, inteiros e dentro da faixa.
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
        const value = params[param.name];
        if (!Number.isSafeInteger(value) || value < param.min || value > param.max) {
            return { ok: false, reason: ResolutionFailure.INVALID_PARAM, action, param };
        }
    }
    return { ok: true, action, params: { ...params } };
}

module.exports = {
    ResolutionFailure,
    SLOT_INTENTS,
    resolveIntent,
    resolvePendingAction,
    isActionIntent: (intentName) => Boolean(SLOT_INTENTS[intentName]),
};
