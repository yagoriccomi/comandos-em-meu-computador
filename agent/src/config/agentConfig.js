'use strict';
/* Configuração sensível do agente (%ProgramData%\OMonstro\config.json), criada pelo instalador. */
const fs = require('fs');
const { protocol } = require('../shared');

const TLS_MQTT_URL = /^mqtts:\/\/[a-z0-9.-]+(:\d{2,5})?$/i;

class ConfigError extends Error {
    constructor(code) {
        super(code);
        this.name = 'ConfigError';
        this.code = code;
    }
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

function validateAgentConfig(config) {
    if (!config || typeof config !== 'object') throw new ConfigError('config_not_object');
    if (!protocol.DEVICE_ID_PATTERN.test(config.deviceId || '')) throw new ConfigError('invalid_device_id');
    if (!isNonEmptyString(config.hmacSecret) || config.hmacSecret.length < protocol.MIN_SECRET_LENGTH) {
        throw new ConfigError('invalid_hmac_secret');
    }
    if (!isNonEmptyString(config.pipeSecret) || config.pipeSecret.length < protocol.MIN_SECRET_LENGTH) {
        throw new ConfigError('invalid_pipe_secret');
    }
    const mqtt = config.mqtt || {};
    if (!TLS_MQTT_URL.test(mqtt.url || '')) throw new ConfigError('invalid_mqtt_url');
    if (!isNonEmptyString(mqtt.username) || !isNonEmptyString(mqtt.password)) throw new ConfigError('invalid_mqtt_credentials');
    return Object.freeze({
        deviceId: config.deviceId,
        hmacSecret: config.hmacSecret,
        pipeSecret: config.pipeSecret,
        mqtt: Object.freeze({ url: mqtt.url, username: mqtt.username, password: mqtt.password }),
    });
}

function loadAgentConfig(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        throw new ConfigError('config_not_found');
    }
    try {
        return validateAgentConfig(JSON.parse(text));
    } catch (error) {
        if (error instanceof ConfigError) throw error;
        throw new ConfigError('config_not_json');
    }
}

module.exports = { ConfigError, TLS_MQTT_URL, validateAgentConfig, loadAgentConfig };
