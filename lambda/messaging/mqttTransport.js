'use strict';
/* Transporte MQTT sobre TLS para uma única invocação da Lambda (conecta, usa, fecha). */
const crypto = require('crypto');

const CONNECT_TIMEOUT_MS = 2500;
const QOS_AT_LEAST_ONCE = 1;
const CLIENT_ID_PREFIX = 'alexa-';

async function connectMqttTransport({ url, username, password }) {
    const mqtt = require('mqtt');
    const client = await mqtt.connectAsync(url, {
        username,
        password,
        clientId: `${CLIENT_ID_PREFIX}${crypto.randomUUID()}`,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: CONNECT_TIMEOUT_MS,
        rejectUnauthorized: true,
    });
    const handlers = new Map();
    client.on('message', (topic, payload) => {
        const handler = handlers.get(topic);
        if (handler) handler(payload);
    });
    return {
        async subscribe(topic, onMessage) {
            handlers.set(topic, onMessage);
            await client.subscribeAsync(topic, { qos: QOS_AT_LEAST_ONCE });
        },
        async publish(topic, payload) {
            await client.publishAsync(topic, payload, { qos: QOS_AT_LEAST_ONCE, retain: false });
        },
        async close() {
            await client.endAsync();
        },
    };
}

module.exports = { connectMqttTransport };
