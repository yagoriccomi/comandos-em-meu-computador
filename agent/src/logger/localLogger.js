'use strict';
/*
 * Log local em JSON (uma linha por evento), com rotação por tamanho e máscara de dados pessoais:
 * nome do usuário do Windows e caminhos C:\Users\<nome> nunca são gravados em claro.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LOG_BYTES = 1024 * 1024;
const ROTATED_FILES_KEPT = 3;
const USERS_PATH = /([a-z]:[\\/]+users[\\/]+)[^\\/\s"']+/gi;
const MIN_MASKABLE_NAME_LENGTH = 3;
const Level = Object.freeze({ DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' });

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createMasker(usernames) {
    const names = usernames.filter((name) => typeof name === 'string' && name.length >= MIN_MASKABLE_NAME_LENGTH);
    const namePattern = names.length ? new RegExp(names.map(escapeRegExp).join('|'), 'gi') : null;
    function maskText(text) {
        const withoutProfile = text.replace(USERS_PATH, '$1<usuario>');
        return namePattern ? withoutProfile.replace(namePattern, '<usuario>') : withoutProfile;
    }
    function mask(value) {
        if (typeof value === 'string') return maskText(value);
        if (Array.isArray(value)) return value.map(mask);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, mask(inner)]));
        }
        return value;
    }
    return mask;
}

function currentUsernames() {
    const names = [process.env.USERNAME];
    try {
        names.push(os.userInfo().username);
    } catch (error) {
        // sem perfil carregado (ex.: antes do logon): segue só com a variável de ambiente
    }
    return [...new Set(names.filter(Boolean))];
}

function rotateIfNeeded(filePath) {
    let size = 0;
    try {
        size = fs.statSync(filePath).size;
    } catch (error) {
        return;
    }
    if (size < MAX_LOG_BYTES) return;
    for (let index = ROTATED_FILES_KEPT - 1; index >= 1; index -= 1) {
        const from = `${filePath}.${index}`;
        if (fs.existsSync(from)) fs.renameSync(from, `${filePath}.${index + 1}`);
    }
    fs.renameSync(filePath, `${filePath}.1`);
}

/**
 * @param {{ directory: string, fileName: string, component: string, usernames?: string[], mirrorToConsole?: boolean }} options
 */
function createLocalLogger({ directory, fileName, component, usernames = currentUsernames(), mirrorToConsole = false, clock = () => new Date() }) {
    const filePath = path.join(directory, fileName);
    const mask = createMasker(usernames);
    let directoryReady = false;

    function write(level, fields) {
        const entry = mask({ ts: clock().toISOString(), level, component, ...fields });
        const line = `${JSON.stringify(entry)}\n`;
        try {
            if (!directoryReady) {
                fs.mkdirSync(directory, { recursive: true });
                directoryReady = true;
            }
            rotateIfNeeded(filePath);
            fs.appendFileSync(filePath, line);
        } catch (error) {
            // Log nunca derruba o agente.
        }
        if (mirrorToConsole) process.stdout.write(line);
    }

    return Object.freeze({
        filePath,
        debug: (fields) => write(Level.DEBUG, fields),
        info: (fields) => write(Level.INFO, fields),
        warn: (fields) => write(Level.WARN, fields),
        error: (fields) => write(Level.ERROR, fields),
    });
}

module.exports = { MAX_LOG_BYTES, createMasker, createLocalLogger };
