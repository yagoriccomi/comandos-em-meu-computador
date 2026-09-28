'use strict';
/* Gera identificador do PC, segredos e os dois arquivos de configuração (PC e Alexa). */
const crypto = require('crypto');

const SECRET_BYTES = 32;
const DEVICE_ID_RANDOM_BYTES = 6;
const DEFAULT_MQTT_PORT = 8883;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const SKILL_ID_PATTERN = /^amzn1\.ask\.skill\.[0-9a-f-]{36}$/i;

function randomSecret() {
    return crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

/** Aceita "abc.s1.eu.hivemq.cloud", "abc...:8883" ou "mqtts://abc...:8883"; devolve URL mqtts ou undefined. */
function normalizeBrokerUrl(input) {
    const text = String(input || '').trim().replace(/^mqtts:\/\//i, '').replace(/\/+$/, '');
    const [host, port = String(DEFAULT_MQTT_PORT), ...rest] = text.split(':');
    if (rest.length || !HOST_PATTERN.test(host) || !/^\d{2,5}$/.test(port)) return undefined;
    return `mqtts://${host.toLowerCase()}:${port}`;
}

function isValidSkillId(skillId) {
    return SKILL_ID_PATTERN.test(String(skillId || '').trim());
}

function generateIdentity() {
    return {
        deviceId: `pc-${crypto.randomBytes(DEVICE_ID_RANDOM_BYTES).toString('hex')}`,
        hmacSecret: randomSecret(),
        pipeSecret: randomSecret(),
    };
}

/**
 * @param {{ deviceId, hmacSecret, pipeSecret }} identity
 * @param {{ brokerUrl, pcUser, pcPassword, alexaUser, alexaPassword, skillId }} answers
 */
function buildConfigFiles(identity, answers) {
    const agentConfig = {
        deviceId: identity.deviceId,
        hmacSecret: identity.hmacSecret,
        pipeSecret: identity.pipeSecret,
        mqtt: { url: answers.brokerUrl, username: answers.pcUser, password: answers.pcPassword },
    };
    const alexaSecrets = {
        skillId: answers.skillId.trim(),
        deviceId: identity.deviceId,
        hmacSecret: identity.hmacSecret,
        mqtt: { url: answers.brokerUrl, username: answers.alexaUser, password: answers.alexaPassword },
        allowedUserIdHashes: [],
    };
    return { agentConfig, alexaSecrets };
}

module.exports = { normalizeBrokerUrl, isValidSkillId, generateIdentity, buildConfigFiles };
