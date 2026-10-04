'use strict';
/*
 * Revalida no PC os parâmetros recebidos (a mensagem já veio assinada, mas o agente não confia em nada):
 * exatamente os declarados no catálogo público, cada um válido para o seu tipo.
 */
const { protocol, ParamType, VERB_PATTERN } = require('../shared');

function isValidValue(param, value) {
    switch (param.type) {
        case ParamType.INTEGER:
        case ParamType.DURATION:
            return Number.isSafeInteger(value) && value >= param.min && value <= param.max;
        case ParamType.TEXT:
            return protocol.isValidTextParam(value) && value.length <= param.maxLength;
        case ParamType.VERB:
            return typeof value === 'string' && VERB_PATTERN.test(value);
        default:
            return false;
    }
}

/** @returns {boolean} */
function hasValidParams(publicAction, params) {
    const declared = publicAction.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
    const declaredNames = new Set(declared.map((param) => param.name));
    if (Object.keys(params).some((name) => !declaredNames.has(name))) return false;
    return declared.every((param) => {
        const present = Object.prototype.hasOwnProperty.call(params, param.name);
        if (!present) return param.optional === true;
        return isValidValue(param, params[param.name]);
    });
}

module.exports = { hasValidParams };
