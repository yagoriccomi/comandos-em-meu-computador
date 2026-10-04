'use strict';
/*
 * Revalida no PC os parâmetros recebidos (a mensagem já veio assinada, mas o agente não confia em nada):
 * exatamente os declarados no catálogo público, cada um válido para o seu tipo.
 */
const { protocol, ParamType, PROGRAM_ID_PATTERN } = require('../shared');

function isValidValue(param, value) {
    switch (param.type) {
        case ParamType.INTEGER:
        case ParamType.DURATION:
            return Number.isSafeInteger(value) && value >= param.min && value <= param.max;
        case ParamType.TEXT:
            return protocol.isValidTextParam(value) && value.length <= param.maxLength;
        case ParamType.PROGRAM:
            return typeof value === 'string' && PROGRAM_ID_PATTERN.test(value);
        default:
            return false;
    }
}

/** @returns {boolean} */
function hasValidParams(publicAction, params) {
    const declared = publicAction.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
    const received = Object.keys(params);
    if (received.length !== declared.length) return false;
    return declared.every((param) => Object.prototype.hasOwnProperty.call(params, param.name) && isValidValue(param, params[param.name]));
}

module.exports = { hasValidParams };
