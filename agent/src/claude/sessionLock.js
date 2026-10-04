'use strict';
/*
 * Trava do Claude Code por voz: PIN de 4 a 8 dígitos (hash scrypt com sal, nunca o PIN em texto) que abre uma
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
// A Lambda lê o PIN dígito a dígito (texto, não número), então zero no começo é aceito.
const PIN_PATTERN = /^\d{4,8}$/;
/** PINs que qualquer um tenta primeiro (além de repetições, sequências e padrões, testados por regra). */
const COMMON_PINS = Object.freeze(new Set([
    '1004', '2000', '2001', '6969', '1122', '1313', '2580', '0852', '1379', '1470',
    '112233', '159753', '147258', '147852', '258369', '102030', '010203', '696969', '123321', '100200',
    '11223344', '12344321', '20202020', '19191919',
]));
const MIN_PATTERN_REPEATS = 2;

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

/** 1234, 4321, 0123, 9876: cada dígito ±1 do anterior, sempre na mesma direção. */
function isSequence(pin) {
    const steps = [...pin].slice(1).map((digit, index) => Number(digit) - Number(pin[index]));
    return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

/** 1111, 1212, 123123, 12341234: um bloco curto repetido. */
function isRepeatedBlock(pin) {
    for (let size = 1; size <= pin.length / MIN_PATTERN_REPEATS; size += 1) {
        if (pin.length % size === 0 && pin.slice(0, size).repeat(pin.length / size) === pin) return true;
    }
    return false;
}

/** @returns {string|undefined} o motivo, se o PIN for fraco */
function weakPinReason(pin) {
    if (isRepeatedBlock(pin)) return 'PIN fraco: evite números repetidos ou padrões como 1212.';
    if (isSequence(pin)) return 'PIN fraco: evite sequências como 1234 ou 4321.';
    if (COMMON_PINS.has(pin)) return 'PIN fraco: esse é um dos PINs mais usados. Escolha outro.';
    return undefined;
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
            if (!isValidPin(pin)) throw new Error('O PIN precisa ter de 4 a 8 dígitos.');
            const weakness = weakPinReason(pin);
            if (weakness) throw new Error(weakness);
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

module.exports = { LockStatus, SESSION_DURATION_MS, MAX_FAILURES, isValidPin, weakPinReason, createSessionLock };
