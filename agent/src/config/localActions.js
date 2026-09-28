'use strict';
/*
 * Parte LOCAL do catálogo (actions.json): o que cada id do catálogo público executa neste PC.
 * Regras (ver CLAUDE.md): executável absoluto, argumentos fixos, sem shell; o único dado variável
 * permitido é um placeholder que ocupa um argumento inteiro ("{minutos}" ou "{minutos*60}") e que
 * corresponde a um parâmetro declarado e validado no catálogo público.
 */
const fs = require('fs');
const path = require('path');

const MAX_SYNC_TIMEOUT_MS = 3500; // precisa responder antes de a skill desistir do ack (4,5 s)
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_SUCCESS_EXIT_CODES = Object.freeze([0]);
const PLACEHOLDER = /^\{([a-z][a-z0-9_]*)(?:\*(\d{1,5}))?\}$/;
const LOOKS_LIKE_PLACEHOLDER = /\{[^}]*\}/;
const FORBIDDEN_EXTENSIONS = Object.freeze(['.bat', '.cmd']);
const SHELL_INTERPRETERS = Object.freeze(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'bash.exe', 'wsl.exe']);

class LocalActionsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LocalActionsError';
    }
}

function parseArg(actionId, arg, publicAction) {
    if (typeof arg !== 'string') throw new LocalActionsError(`${actionId}: argumentos devem ser texto`);
    const match = PLACEHOLDER.exec(arg);
    if (!match) {
        if (LOOKS_LIKE_PLACEHOLDER.test(arg) && !/^https?:\/\//i.test(arg)) {
            throw new LocalActionsError(`${actionId}: placeholder mal formado em "${arg}"`);
        }
        return Object.freeze({ literal: arg });
    }
    const [, paramName, multiplier] = match;
    if (!publicAction.params.some((param) => param.name === paramName)) {
        throw new LocalActionsError(`${actionId}: parâmetro {${paramName}} não existe no catálogo público`);
    }
    return Object.freeze({ paramName, multiplier: multiplier ? Number(multiplier) : 1 });
}

function validateEntry(entry, publicAction, { checkFileExists }) {
    const id = entry.id;
    if (typeof entry.enabled !== 'boolean') throw new LocalActionsError(`${id}: "enabled" obrigatório`);
    if (!entry.enabled) return Object.freeze({ id, enabled: false, publicAction });

    const executable = entry.executable;
    if (typeof executable !== 'string' || !path.win32.isAbsolute(executable)) {
        throw new LocalActionsError(`${id}: "executable" precisa ser um caminho absoluto`);
    }
    const extension = path.win32.extname(executable).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.includes(extension)) {
        throw new LocalActionsError(`${id}: .bat/.cmd não são aceitos diretamente (use cmd.exe com argumentos fixos)`);
    }
    if (checkFileExists && !fs.existsSync(executable)) throw new LocalActionsError(`${id}: executável não encontrado`);
    if (!Array.isArray(entry.args)) throw new LocalActionsError(`${id}: "args" deve ser lista`);

    const args = Object.freeze(entry.args.map((arg) => parseArg(id, arg, publicAction)));
    const usesParams = args.some((arg) => arg.paramName);
    const isShell = SHELL_INTERPRETERS.includes(path.win32.basename(executable).toLowerCase());
    if (usesParams && isShell) {
        throw new LocalActionsError(`${id}: interpretadores de comando não podem receber parâmetros`);
    }

    const waitForExit = entry.waitForExit !== false;
    const timeoutMs = entry.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : entry.timeoutMs;
    if (waitForExit && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_SYNC_TIMEOUT_MS)) {
        throw new LocalActionsError(`${id}: timeoutMs deve ser de 1 a ${MAX_SYNC_TIMEOUT_MS} (ou use "waitForExit": false)`);
    }
    const successExitCodes = entry.successExitCodes === undefined ? DEFAULT_SUCCESS_EXIT_CODES : entry.successExitCodes;
    if (!Array.isArray(successExitCodes) || !successExitCodes.every(Number.isSafeInteger)) {
        throw new LocalActionsError(`${id}: successExitCodes inválido`);
    }

    return Object.freeze({
        id,
        enabled: true,
        publicAction,
        executable,
        args,
        waitForExit,
        timeoutMs,
        successExitCodes: Object.freeze([...successExitCodes]),
    });
}

/**
 * @returns {{ get: (id: string) => object|undefined, ids: string[] }}
 */
function buildLocalActions(source, publicCatalog, { checkFileExists = true } = {}) {
    if (!source || !Array.isArray(source.actions)) throw new LocalActionsError('actions.json sem lista "actions"');
    const byId = new Map();
    for (const entry of source.actions) {
        const publicAction = publicCatalog.findById(entry && entry.id);
        if (!publicAction) throw new LocalActionsError(`id fora do catálogo público: ${entry && entry.id}`);
        if (byId.has(entry.id)) throw new LocalActionsError(`id duplicado: ${entry.id}`);
        byId.set(entry.id, validateEntry(entry, publicAction, { checkFileExists }));
    }
    return Object.freeze({ get: (id) => byId.get(id), ids: Object.freeze([...byId.keys()]) });
}

function loadLocalActions(filePath, publicCatalog, options) {
    let source;
    try {
        source = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
    } catch (error) {
        throw new LocalActionsError('actions.json ausente ou não é JSON válido');
    }
    return buildLocalActions(source, publicCatalog, options);
}

module.exports = {
    MAX_SYNC_TIMEOUT_MS,
    LocalActionsError,
    buildLocalActions,
    loadLocalActions,
};
