'use strict';
/* Carrega e valida o catálogo público de ações (sem executáveis: isso só existe no PC). */
const rawCatalog = require('../catalog/skill-catalog.json');
const { ACTION_ID_PATTERN } = require('../protocol/message');

const SUPPORTED_SLOT_TYPES = Object.freeze(['TIPO_APLICATIVO', 'TIPO_ROTINA']);
const SUPPORTED_PARAM_TYPES = Object.freeze(['integer']);

class CatalogError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CatalogError';
    }
}

function validateParam(actionId, param) {
    if (!param || typeof param.name !== 'string' || typeof param.slot !== 'string') {
        throw new CatalogError(`${actionId}: parâmetro sem name/slot`);
    }
    if (!SUPPORTED_PARAM_TYPES.includes(param.type)) {
        throw new CatalogError(`${actionId}: tipo de parâmetro não suportado`);
    }
    if (!Number.isSafeInteger(param.min) || !Number.isSafeInteger(param.max) || param.min > param.max) {
        throw new CatalogError(`${actionId}: faixa inválida em ${param.name}`);
    }
}

function validateAction(action) {
    if (!ACTION_ID_PATTERN.test(action.id || '')) throw new CatalogError(`id inválido: ${action.id}`);
    const hasSlotType = typeof action.slotType === 'string';
    const hasIntent = typeof action.intent === 'string';
    if (hasSlotType === hasIntent) throw new CatalogError(`${action.id}: defina slotType OU intent`);
    if (hasSlotType && !SUPPORTED_SLOT_TYPES.includes(action.slotType)) {
        throw new CatalogError(`${action.id}: slotType desconhecido`);
    }
    if (hasSlotType && (!Array.isArray(action.synonyms) || action.synonyms.length === 0)) {
        throw new CatalogError(`${action.id}: sem sinônimos`);
    }
    if (typeof action.requiresConfirmation !== 'boolean' || typeof action.requiresDesktop !== 'boolean') {
        throw new CatalogError(`${action.id}: flags obrigatórias ausentes`);
    }
    if (!Array.isArray(action.params)) throw new CatalogError(`${action.id}: params deve ser lista`);
    action.params.forEach((param) => validateParam(action.id, param));
}

function buildCatalog(source) {
    if (!source || !Array.isArray(source.actions)) throw new CatalogError('catálogo sem lista de ações');
    const byId = new Map();
    for (const action of source.actions) {
        validateAction(action);
        if (byId.has(action.id)) throw new CatalogError(`id duplicado: ${action.id}`);
        byId.set(action.id, Object.freeze({ ...action }));
    }
    const byIntent = new Map([...byId.values()].filter((action) => action.intent).map((action) => [action.intent, action]));
    return Object.freeze({
        version: source.version,
        actions: Object.freeze([...byId.values()]),
        findById: (id) => byId.get(id),
        findByIntent: (intentName) => byIntent.get(intentName),
    });
}

module.exports = {
    SUPPORTED_SLOT_TYPES,
    CatalogError,
    buildCatalog,
    catalog: buildCatalog(rawCatalog),
};
