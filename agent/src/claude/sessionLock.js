'use strict';
/*
 * Trava do Claude Code por voz: PIN de 6 dígitos (hash scrypt com sal, nunca o PIN em texto) que abre uma
 * "sessão ativa" de 3 horas. "Encerrar sessão do Claude Code" fecha na hora. 5 erros em 15 min bloqueiam 15 min.
 * Arquivo privado do usuário: %LOCALAPPDATA%\OMonstro\claude-code.json.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_DURATION_MS = 3 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
// Sem zero inicial: a Alexa entrega o PIN como número e "0123…" perderia o zero.
const PIN_PATTERN = /^[1-9]\d{5}$/;

const LockStatus = Object.freeze({
    OK: 'ok',
    PIN_REQUIRED: 'pin_required',
    LOCKED: 'locked',
    NO_PIN: 'no_pin',
});

function hashPin(pin, salt) {
    return crypto.scryptSync(pin, salt, KEY_BYTES).toString('hex');
}

function isValidPin(pin) {
    return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

/**
 * @param {{ filePath: string, clock?: () => number }} deps
 */
function createSessionLock({ filePath, clock = Date.now }) {
    function read() {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            return {};
        }
    }

    function write(state) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
    }

    function pinMatches(state, pin) {
        if (!state.pin || !isValidPin(pin)) return false;
        const expected = Buffer.from(state.pin.hash, 'hex');
        const received = Buffer.from(hashPin(pin, Buffer.from(state.pin.salt, 'hex')), 'hex');
        return expected.length === received.length && crypto.timingSafeEqual(expected, received);
    }

    return {
        hasPin: () => Boolean(read().pin),

        /** Definido só pela bandeja (no PC), nunca pela Alexa. */
        setPin(pin) {
            if (!isValidPin(pin)) throw new Error('O PIN precisa ter 6 dígitos e não pode começar com 0.');
            const salt = crypto.randomBytes(SALT_BYTES);
            write({ pin: { salt: salt.toString('hex'), hash: hashPin(pin, salt) }, activeUntil: 0, failures: [], lockedUntil: 0 });
        },

        /**
         * @param {string|undefined} pin  dígitos falados (ausente = só consulta se a sessão está ativa)
         * @returns {string} LockStatus
         */
        check(pin) {
            const state = read();
            const now = clock();
            if (!state.pin) return LockStatus.NO_PIN;
            if ((state.lockedUntil || 0) > now) return LockStatus.LOCKED;
            if ((state.activeUntil || 0) > now) return LockStatus.OK;
            if (pin === undefined) return LockStatus.PIN_REQUIRED;
            if (pinMatches(state, pin)) {
                write({ ...state, activeUntil: now + SESSION_DURATION_MS, failures: [], lockedUntil: 0 });
                return LockStatus.OK;
            }
            const failures = [...(state.failures || []).filter((at) => at > now - FAILURE_WINDOW_MS), now];
            const locked = failures.length >= MAX_FAILURES;
            write({ ...state, failures: locked ? [] : failures, lockedUntil: locked ? now + LOCKOUT_MS : 0 });
            return locked ? LockStatus.LOCKED : LockStatus.PIN_REQUIRED;
        },

        /** "Encerrar sessão do Claude Code": a próxima ordem pede o PIN de novo. */
        revoke() {
            const state = read();
            if (state.pin) write({ ...state, activeUntil: 0 });
        },
    };
}

module.exports = { LockStatus, SESSION_DURATION_MS, MAX_FAILURES, isValidPin, createSessionLock };
