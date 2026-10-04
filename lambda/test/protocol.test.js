'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../protocol/message');

const SECRET = 'a'.repeat(protocol.MIN_SECRET_LENGTH);
const OTHER_SECRET = 'b'.repeat(protocol.MIN_SECRET_LENGTH);
const NOW = 1_800_000_000_000;

function verifyCommand(message, options = {}) {
    return protocol.verify(message, { secret: SECRET, expectedType: protocol.MessageType.COMMAND, now: NOW, ...options });
}

function assertRejectedWith(code, fn) {
    assert.throws(fn, (error) => error instanceof protocol.ProtocolError && error.code === code);
}

test('shouldAcceptCommandSignedWithSameSecretInsideWindow', () => {
    const command = protocol.createCommand({ actionId: 'desligar_em_minutos', params: { minutos: 30 } }, SECRET, NOW);
    const roundTrip = protocol.parse(protocol.serialize(command));
    assert.equal(verifyCommand(roundTrip).actionId, 'desligar_em_minutos');
});

test('shouldGenerateUniqueRequestIdPerCommand', () => {
    const first = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW);
    const second = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW);
    assert.notEqual(first.requestId, second.requestId);
});

test('shouldRejectCommandSignedWithAnotherSecret', () => {
    const command = protocol.createCommand({ actionId: 'abrir_netflix' }, OTHER_SECRET, NOW);
    assertRejectedWith('bad_signature', () => verifyCommand(command));
});

test('shouldRejectCommandWhenActionIdIsTampered', () => {
    const command = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW);
    assertRejectedWith('bad_signature', () => verifyCommand({ ...command, actionId: 'reiniciar_pc' }));
});

test('shouldRejectCommandWhenParamIsTampered', () => {
    const command = protocol.createCommand({ actionId: 'desligar_em_minutos', params: { minutos: 30 } }, SECRET, NOW);
    assertRejectedWith('bad_signature', () => verifyCommand({ ...command, params: { minutos: 1 } }));
});

test('shouldRejectCommandWithoutSignature', () => {
    const { sig, ...unsigned } = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW);
    assertRejectedWith('bad_signature', () => verifyCommand(unsigned));
});

test('shouldRejectExpiredCommand', () => {
    const command = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW - protocol.MESSAGE_TTL_MS - 1);
    assertRejectedWith('expired', () => verifyCommand(command));
});

test('shouldRejectCommandFromTheFuture', () => {
    const command = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW + protocol.MAX_CLOCK_SKEW_MS + 1);
    assertRejectedWith('from_future', () => verifyCommand(command));
});

test('shouldRejectUnknownProtocolVersion', () => {
    const command = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW);
    assert.equal(command.v, 2);
    for (const v of [1, 3]) {
        assertRejectedWith('unsupported_version', () => verifyCommand({ ...command, v }));
    }
});

test('shouldRejectAckWhenCommandWasExpected', () => {
    const command = protocol.createCommand({ actionId: 'abrir_netflix' }, SECRET, NOW);
    const ack = protocol.createAck({ requestId: command.requestId, status: protocol.AckStatus.OK }, SECRET, NOW);
    assertRejectedWith('wrong_type', () => verifyCommand(ack));
});

test('shouldRejectActionIdWithShellCharacters', () => {
    assertRejectedWith('malformed', () => protocol.createCommand({ actionId: 'abrir & del' }, SECRET, NOW));
});

test('shouldRejectParamsThatAreNeitherIntegerNorShortText', () => {
    const tooLong = 'x'.repeat(protocol.MAX_TEXT_PARAM_LENGTH + 1);
    for (const minutos of [2.5, null, Number.NaN, '', tooLong, 'linha\nnova', 'nulo\u0000', true, [1], { a: 1 }]) {
        assertRejectedWith('malformed', () =>
            protocol.createCommand({ actionId: 'desligar_em_minutos', params: { minutos } }, SECRET, NOW));
    }
});

test('shouldCarrySignedShortTextParam', () => {
    const command = protocol.createCommand({ actionId: 'pesquisar_google', params: { consulta: 'receita de pão & café' } }, SECRET, NOW);
    const verified = verifyCommand(protocol.parse(protocol.serialize(command)));
    assert.equal(verified.params.consulta, 'receita de pão & café');
    assertRejectedWith('bad_signature', () => verifyCommand({ ...command, params: { consulta: 'outra coisa' } }));
});

test('shouldRejectOversizedPayload', () => {
    assertRejectedWith('too_large', () => protocol.parse('x'.repeat(protocol.MAX_MESSAGE_BYTES + 1)));
});

test('shouldRejectInvalidJson', () => {
    assertRejectedWith('malformed', () => protocol.parse('{not json'));
});

test('shouldRefuseShortSecret', () => {
    assertRejectedWith('invalid_secret', () => protocol.createCommand({ actionId: 'abrir_netflix' }, 'curto', NOW));
});

test('shouldVerifySignedAck', () => {
    const ack = protocol.createAck({ requestId: '9b2f7a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b', status: 'error' }, SECRET, NOW);
    const verified = protocol.verify(ack, { secret: SECRET, expectedType: protocol.MessageType.ACK, now: NOW });
    assert.equal(verified.status, 'error');
});

test('shouldBuildTopicsOnlyForValidDeviceId', () => {
    assert.equal(protocol.commandTopic('pc-casa-1234'), 'omonstro/pc-casa-1234/cmd');
    assert.equal(protocol.ackTopic('pc-casa-1234'), 'omonstro/pc-casa-1234/ack');
    assertRejectedWith('invalid_device_id', () => protocol.commandTopic('#'));
});

test('shouldProduceSameCanonicalFormRegardlessOfKeyOrder', () => {
    assert.equal(protocol.canonicalize({ b: 1, a: { d: 2, c: 3 } }), protocol.canonicalize({ a: { c: 3, d: 2 }, b: 1 }));
});
