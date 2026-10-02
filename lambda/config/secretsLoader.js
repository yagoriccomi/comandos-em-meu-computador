'use strict';
/*
 * Segredos da skill: arquivo config/secrets.json no bucket S3 que a Alexa-hosted fornece
 * (variável S3_PERSISTENCE_BUCKET). Lido uma vez por instância da Lambda e mantido em memória.
 * Nunca logar o conteúdo.
 */
const { MIN_SECRET_LENGTH, DEVICE_ID_PATTERN } = require('../protocol/message');

const SECRETS_OBJECT_KEY = 'config/secrets.json';
const SKILL_ID_PREFIX = 'amzn1.ask.skill.';
const TLS_MQTT_URL = /^mqtts:\/\/[a-z0-9.-]+(:\d{2,5})?$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;

class SecretsError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SecretsError';
        this.code = code;
    }
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

function validateSecrets(secrets) {
    if (!secrets || typeof secrets !== 'object') throw new SecretsError('secrets_not_object');
    if (!isNonEmptyString(secrets.skillId) || !secrets.skillId.startsWith(SKILL_ID_PREFIX)) throw new SecretsError('invalid_skill_id');
    if (!DEVICE_ID_PATTERN.test(secrets.deviceId || '')) throw new SecretsError('invalid_device_id');
    if (!isNonEmptyString(secrets.hmacSecret) || secrets.hmacSecret.length < MIN_SECRET_LENGTH) throw new SecretsError('invalid_hmac_secret');
    const mqtt = secrets.mqtt || {};
    if (!TLS_MQTT_URL.test(mqtt.url || '')) throw new SecretsError('invalid_mqtt_url');
    if (!isNonEmptyString(mqtt.username) || !isNonEmptyString(mqtt.password)) throw new SecretsError('invalid_mqtt_credentials');
    const hashes = secrets.allowedUserIdHashes;
    if (hashes !== undefined && (!Array.isArray(hashes) || !hashes.every((hash) => SHA256_HEX.test(hash)))) {
        throw new SecretsError('invalid_user_hashes');
    }
    return Object.freeze({
        skillId: secrets.skillId,
        deviceId: secrets.deviceId,
        hmacSecret: secrets.hmacSecret,
        mqtt: Object.freeze({ url: mqtt.url, username: mqtt.username, password: mqtt.password }),
        allowedUserIdHashes: Object.freeze(hashes ? [...hashes] : []),
    });
}

/**
 * @param {{ readObject: (bucket: string, key: string) => Promise<string>, bucket: string }} deps
 */
function createSecretsLoader({ readObject, bucket }) {
    let cached;
    return async function loadSecrets() {
        if (!cached) {
            cached = (async () => {
                if (!isNonEmptyString(bucket)) throw new SecretsError('missing_bucket');
                const text = await readObject(bucket, SECRETS_OBJECT_KEY);
                let parsed;
                try {
                    parsed = JSON.parse(text);
                } catch (error) {
                    throw new SecretsError('secrets_not_json');
                }
                return validateSecrets(parsed);
            })();
            // Falhou? Não guarda o erro: a próxima invocação tenta de novo.
            cached.catch(() => { cached = undefined; });
        }
        return cached;
    };
}

function isModuleNotFound(error) {
    return Boolean(error) && error.code === 'MODULE_NOT_FOUND';
}

/**
 * Usa o SDK da AWS que o PRÓPRIO runtime da Lambda traz, sem declará-lo no package.json:
 * - Node 16 (Alexa-hosted hoje): aws-sdk v2 embutido;
 * - Node 18+: @aws-sdk/client-s3 (v3) embutido.
 * Declarar o v3 como dependência quebrava o deploy: o builder (yarn 1, Node 16) recusa pacotes que exigem Node 20.
 */
function createS3ObjectReader({ requireModule = require, region = process.env.S3_PERSISTENCE_REGION } = {}) {
    try {
        const AWS = requireModule('aws-sdk');
        const client = new AWS.S3({ region, signatureVersion: 'v4' });
        return async function readObject(bucket, key) {
            const response = await client.getObject({ Bucket: bucket, Key: key }).promise();
            return response.Body.toString('utf8');
        };
    } catch (error) {
        if (!isModuleNotFound(error)) throw error;
    }
    const { S3Client, GetObjectCommand } = requireModule('@aws-sdk/client-s3');
    const client = new S3Client({ region });
    return async function readObject(bucket, key) {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return response.Body.transformToString('utf8');
    };
}

module.exports = {
    SECRETS_OBJECT_KEY,
    SecretsError,
    validateSecrets,
    createSecretsLoader,
    createS3ObjectReader,
};
