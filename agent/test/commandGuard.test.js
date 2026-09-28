'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { protocol } = require('../src/shared');
const { createCommandGuard, createRateLimiter, createReplayGuard, REPLAY_WINDOW_MS } = require('../src/security/commandGuard');

const SECRET = 'h'.repeat(43);
const NOW = 1_800_000_000_000;

function signed(overrides = {}, secret = SECRET, ts = NOW) {
    return protocol.serialize({ ...protocol.createCommand({ actionId: 'abrir_netflix' }, secret, ts), ...overrides });
}

test('shouldAcceptValidCommandOnce', () => {
    const guard = createCommandGuard({ secret: SECRET, clock: () => NOW });
    const raw = signed();
    assert.equal(guard.inspect(raw).ok, true);
    assert.deepEqual(guard.inspect(raw), { ok: false, reason: 'replayed' });
});

test('shouldRejectForgedExpiredAndMalformedMessages', () => {
    const guard = createCommandGuard({ secret: SECRET, clock: () => NOW });
    assert.equal(guard.inspect(signed({}, 'x'.repeat(43))).reason, 'bad_signature');
    assert.equal(guard.inspect(signed({}, SECRET, NOW - protocol.MESSAGE_TTL_MS - 1)).reason, 'expired');
    assert.equal(guard.inspect('{"type":"cmd"').reason, 'malformed');
    assert.equal(guard.inspect(Buffer.alloc(protocol.MAX_MESSAGE_BYTES + 1, 'a')).reason, 'too_large');
});

test('shouldNotRememberRequestIdOfRejectedMessage', () => {
    const guard = createCommandGuard({ secret: SECRET, clock: () => NOW });
    const good = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW);
    const forged = protocol.serialize({ ...good, sig: 'AAAA' });
    assert.equal(guard.inspect(forged).reason, 'bad_signature');
    assert.equal(guard.inspect(protocol.serialize(good)).ok, true);
});

test('shouldForgetRequestIdAfterReplayWindow', () => {
    const replayGuard = createReplayGuard();
    assert.equal(replayGuard.remember('id-1', NOW), true);
    assert.equal(replayGuard.remember('id-1', NOW + 1), false);
    assert.equal(replayGuard.remember('id-1', NOW + REPLAY_WINDOW_MS + 1), true);
});

test('shouldBoundReplayMemory', () => {
    const replayGuard = createReplayGuard({ maxEntries: 2 });
    replayGuard.remember('a', NOW);
    replayGuard.remember('b', NOW);
    replayGuard.remember('c', NOW);
    assert.equal(replayGuard.remember('c', NOW), false);
    assert.equal(replayGuard.remember('a', NOW), true);
});

test('shouldRateLimitBursts', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    assert.equal(limiter.allow(NOW), true);
    assert.equal(limiter.allow(NOW), true);
    assert.equal(limiter.allow(NOW), false);
    assert.equal(limiter.allow(NOW + 1001), true);
});
