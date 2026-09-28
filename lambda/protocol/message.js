'use strict';
/*
 * Protocolo de mensagens entre a skill e o agente.
 * ATENÇÃO: este arquivo existe em DUAS cópias idênticas (lambda/protocol e agent/src/protocol),
 * porque a Lambda Alexa-hosted só empacota a pasta lambda/. Um teste do agente garante a igualdade.
 */
const crypto = require('crypto');

const PROTOCOL_VERSION = 1;
const MESSAGE_TTL_MS = 30 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const MAX_MESSAGE_BYTES = 4096;
const MIN_SECRET_LENGTH = 32;
const TOPIC_PREFIX = 'omonstro';

const MessageType = Object.freeze({ COMMAND: 'cmd', ACK: 'ack' });
const AckStatus = Object.freeze({ OK: 'ok', ERROR: 'error' });

const ACTION_ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const PARAM_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const DEVICE_ID_PATTERN = /^[a-z0-9-]{8,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PARAMS = 8;

class ProtocolError extends Error {
    constructor(code) {
        super(code);
        this.name = 'ProtocolError';
        this.code = code;
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

/** JSON determinístico (chaves ordenadas) para que a assinatura não dependa da ordem dos campos. */
function canonicalize(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new ProtocolError('malformed');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    }
    throw new ProtocolError('malformed');
}

function assertSecret(secret) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
        throw new ProtocolError('invalid_secret');
    }
}

function computeSignature(message, secret) {
    assertSecret(secret);
    const { sig, ...unsigned } = message;
    return crypto.createHmac('sha256', secret).update(canonicalize(unsigned)).digest('base64url');
}

function hasValidSignature(message, secret) {
    if (typeof message.sig !== 'string') return false;
    const expected = Buffer.from(computeSignature(message, secret));
    const received = Buffer.from(message.sig);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function isValidParams(params) {
    if (!isPlainObject(params)) return false;
    const entries = Object.entries(params);
    if (entries.length > MAX_PARAMS) return false;
    return entries.every(([name, value]) => PARAM_NAME_PATTERN.test(name) && Number.isSafeInteger(value));
}

function hasValidShape(message) {
    if (!isPlainObject(message)) return false;
    if (!UUID_PATTERN.test(message.requestId || '')) return false;
    if (!Number.isSafeInteger(message.ts)) return false;
    if (message.type === MessageType.COMMAND) {
        return ACTION_ID_PATTERN.test(message.actionId || '') && isValidParams(message.params);
    }
    if (message.type === MessageType.ACK) {
        return Object.values(AckStatus).includes(message.status);
    }
    return false;
}

function createCommand({ actionId, params = {} }, secret, now = Date.now()) {
    const message = { v: PROTOCOL_VERSION, type: MessageType.COMMAND, actionId, params, requestId: crypto.randomUUID(), ts: now };
    if (!hasValidShape(message)) throw new ProtocolError('malformed');
    return { ...message, sig: computeSignature(message, secret) };
}

function createAck({ requestId, status }, secret, now = Date.now()) {
    const message = { v: PROTOCOL_VERSION, type: MessageType.ACK, requestId, status, ts: now };
    if (!hasValidShape(message)) throw new ProtocolError('malformed');
    return { ...message, sig: computeSignature(message, secret) };
}

function serialize(message) {
    return canonicalize(message);
}

/** Converte bytes recebidos do broker em objeto, sem confiar em nada ainda. */
function parse(raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) throw new ProtocolError('too_large');
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new ProtocolError('malformed');
    }
}

/**
 * Valida formato, versão, tipo, assinatura e janela de tempo. Lança ProtocolError com `code`:
 * malformed | unsupported_version | wrong_type | bad_signature | expired | from_future
 */
function verify(message, { secret, expectedType, now = Date.now() }) {
    if (!isPlainObject(message)) throw new ProtocolError('malformed');
    if (message.v !== PROTOCOL_VERSION) throw new ProtocolError('unsupported_version');
    if (message.type !== expectedType) throw new ProtocolError('wrong_type');
    if (!hasValidShape(message)) throw new ProtocolError('malformed');
    if (!hasValidSignature(message, secret)) throw new ProtocolError('bad_signature');
    if (now - message.ts > MESSAGE_TTL_MS) throw new ProtocolError('expired');
    if (message.ts - now > MAX_CLOCK_SKEW_MS) throw new ProtocolError('from_future');
    return message;
}

function assertDeviceId(deviceId) {
    if (!DEVICE_ID_PATTERN.test(deviceId || '')) throw new ProtocolError('invalid_device_id');
}

function commandTopic(deviceId) {
    assertDeviceId(deviceId);
    return `${TOPIC_PREFIX}/${deviceId}/cmd`;
}

function ackTopic(deviceId) {
    assertDeviceId(deviceId);
    return `${TOPIC_PREFIX}/${deviceId}/ack`;
}

module.exports = {
    PROTOCOL_VERSION,
    MESSAGE_TTL_MS,
    MAX_CLOCK_SKEW_MS,
    MAX_MESSAGE_BYTES,
    MIN_SECRET_LENGTH,
    MessageType,
    AckStatus,
    ProtocolError,
    ACTION_ID_PATTERN,
    DEVICE_ID_PATTERN,
    canonicalize,
    createCommand,
    createAck,
    serialize,
    parse,
    verify,
    commandTopic,
    ackTopic,
};
