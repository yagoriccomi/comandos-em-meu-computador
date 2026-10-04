'use strict';
/* Carrega e valida o catálogo público de ações (sem executáveis: isso só existe no PC). */
const rawCatalog = require('../catalog/skill-catalog.json');
const { ACTION_ID_PATTERN, MAX_TEXT_PARAM_LENGTH } = require('../protocol/message');

const SUPPORTED_SLOT_TYPES = Object.freeze(['TIPO_APLICATIVO', 'TIPO_ROTINA']);
const ParamType = Object.freeze({
    INTEGER: 'integer',   // AMAZON.NUMBER: inteiro dentro de min..max (com "default" opcional)
    DURATION: 'duration', // AMAZON.DURATION (ISO 8601, ex.: PT1M30S) convertido em segundos, min..max
    TEXT: 'text',         // AMAZON.SearchQuery: texto curto; NUNCA vira comando (só a URL codificada da pesquisa)
    VERB: 'verb',         // verbo canônico da frase ("abrir", "executar"…; "*" = frase livre), vindo de um slot de verbos
});
const SUPPORTED_PARAM_TYPES = Object.freeze(Object.values(ParamType));
/** Verbo canônico (minúsculas, pode ter acento e espaço) ou "*" para frases livres ("alterna para a TV"). */
const VERB_PATTERN = /^(\*|[a-zà-ú][a-zà-ú ]{1,29})$/;

class CatalogError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CatalogError';
    }
}

function assertRange(actionId, param) {
    if (!Number.isSafeInteger(param.min) || !Number.isSafeInteger(param.max) || param.min > param.max) {
        throw new CatalogError(`${actionId}: faixa inválida em ${param.name}`);
    }
}

function isValidDefault(param) {
    if (param.type === ParamType.VERB) return typeof param.default === 'string' && VERB_PATTERN.test(param.default);
    return param.type === ParamType.INTEGER && Number.isSafeInteger(param.default) && param.default >= param.min && param.default <= param.max;
}

function validateParam(actionId, param) {
    if (!param || typeof param.name !== 'string' || typeof param.slot !== 'string') {
        throw new CatalogError(`${actionId}: parâmetro sem name/slot`);
    }
    if (!SUPPORTED_PARAM_TYPES.includes(param.type)) {
        throw new CatalogError(`${actionId}: tipo de parâmetro não suportado`);
    }
    if (param.type === ParamType.INTEGER || param.type === ParamType.DURATION) assertRange(actionId, param);
    if (param.optional !== undefined && typeof param.optional !== 'boolean') throw new CatalogError(`${actionId}: optional inválido em ${param.name}`);
    if (param.default !== undefined && !isValidDefault(param)) {
        throw new CatalogError(`${actionId}: default inválido em ${param.name}`);
    }
    if (param.type === ParamType.TEXT
        && (!Number.isSafeInteger(param.maxLength) || param.maxLength < 1 || param.maxLength > MAX_TEXT_PARAM_LENGTH)) {
        throw new CatalogError(`${actionId}: maxLength inválido em ${param.name}`);
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
    if (action.voiceLocked !== undefined && typeof action.voiceLocked !== 'boolean') throw new CatalogError(`${action.id}: voiceLocked inválido`);
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
        verbs: Object.freeze({ ...(source.verbs || {}) }),
        programExamples: Object.freeze([...(source.programExamples || [])]),
        actions: Object.freeze([...byId.values()]),
        findById: (id) => byId.get(id),
        findByIntent: (intentName) => byIntent.get(intentName),
    });
}

module.exports = {
    SUPPORTED_SLOT_TYPES,
    ParamType,
    VERB_PATTERN,
    CatalogError,
    buildCatalog,
    catalog: buildCatalog(rawCatalog),
};
