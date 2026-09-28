'use strict';
/*
 * Porta de entrada de toda mensagem vinda do broker: formato, assinatura, validade,
 * anti-replay (requestId já visto) e limite de frequência.
 */
const { protocol } = require('../shared');

const REPLAY_WINDOW_MS = protocol.MESSAGE_TTL_MS + protocol.MAX_CLOCK_SKEW_MS;
const MAX_REMEMBERED_REQUESTS = 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_COMMANDS = 20;

function createReplayGuard({ windowMs = REPLAY_WINDOW_MS, maxEntries = MAX_REMEMBERED_REQUESTS } = {}) {
    const seen = new Map(); // requestId → expira em (ms)

    function prune(now) {
        for (const [requestId, expiresAt] of seen) {
            if (expiresAt <= now) seen.delete(requestId);
        }
        while (seen.size >= maxEntries) seen.delete(seen.keys().next().value);
    }

    /** @returns {boolean} true se é a primeira vez que o requestId aparece dentro da janela */
    function remember(requestId, now) {
        prune(now);
        if (seen.has(requestId)) return false;
        seen.set(requestId, now + windowMs);
        return true;
    }

    return { remember };
}

function createRateLimiter({ windowMs = RATE_LIMIT_WINDOW_MS, max = RATE_LIMIT_MAX_COMMANDS } = {}) {
    const timestamps = [];
    return {
        allow(now) {
            while (timestamps.length && timestamps[0] <= now - windowMs) timestamps.shift();
            if (timestamps.length >= max) return false;
            timestamps.push(now);
            return true;
        },
    };
}

/**
 * @returns {{ inspect: (raw: Buffer|string) => ({ ok: true, command: object } | { ok: false, reason: string }) }}
 */
function createCommandGuard({ secret, clock = Date.now, replayGuard = createReplayGuard(), rateLimiter = createRateLimiter() }) {
    return {
        inspect(raw) {
            const now = clock();
            let command;
            try {
                command = protocol.verify(protocol.parse(raw), { secret, expectedType: protocol.MessageType.COMMAND, now });
            } catch (error) {
                return { ok: false, reason: error.code || 'malformed' };
            }
            if (!replayGuard.remember(command.requestId, now)) return { ok: false, reason: 'replayed' };
            if (!rateLimiter.allow(now)) return { ok: false, reason: 'rate_limited', command };
            return { ok: true, command };
        },
    };
}

module.exports = { REPLAY_WINDOW_MS, createReplayGuard, createRateLimiter, createCommandGuard };
