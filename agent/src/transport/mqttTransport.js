'use strict';
/* Conexão MQTT permanente (TLS) do agente, com reconexão automática e reinscrição nos tópicos. */
const RECONNECT_PERIOD_MS = 5000;
const CONNECT_TIMEOUT_MS = 10000;
const KEEPALIVE_SECONDS = 30;
const QOS_AT_LEAST_ONCE = 1;

const BrokerStatus = Object.freeze({ CONNECTING: 'connecting', CONNECTED: 'connected', OFFLINE: 'offline' });

/**
 * @param {{ url: string, username: string, password: string, clientId: string, logger: object,
 *           onStatus?: (status: string) => void, mqttLib?: object }} options
 */
function createPersistentMqttTransport({ url, username, password, clientId, logger, onStatus = () => {}, mqttLib }) {
    const mqtt = mqttLib || require('mqtt');
    const handlers = new Map();
    onStatus(BrokerStatus.CONNECTING);
    const client = mqtt.connect(url, {
        username,
        password,
        clientId,
        clean: true,
        resubscribe: true,
        keepalive: KEEPALIVE_SECONDS,
        reconnectPeriod: RECONNECT_PERIOD_MS,
        connectTimeout: CONNECT_TIMEOUT_MS,
        rejectUnauthorized: true,
    });

    client.on('connect', () => {
        logger.info({ event: 'broker_connected' });
        onStatus(BrokerStatus.CONNECTED);
        for (const topic of handlers.keys()) {
            client.subscribe(topic, { qos: QOS_AT_LEAST_ONCE }, (error) => {
                if (error) logger.warn({ event: 'subscribe_failed', errorName: error.name });
            });
        }
    });
    client.on('offline', () => onStatus(BrokerStatus.OFFLINE));
    client.on('close', () => onStatus(BrokerStatus.OFFLINE));
    client.on('error', (error) => logger.warn({ event: 'broker_error', errorCode: error.code, errorName: error.name }));
    client.on('message', (topic, payload) => {
        const handler = handlers.get(topic);
        if (handler) handler(payload);
    });

    return {
        async subscribe(topic, onMessage) {
            handlers.set(topic, onMessage);
            if (client.connected) await client.subscribeAsync(topic, { qos: QOS_AT_LEAST_ONCE });
        },
        async publish(topic, payload) {
            await client.publishAsync(topic, payload, { qos: QOS_AT_LEAST_ONCE, retain: false });
        },
        async close() {
            await client.endAsync();
        },
    };
}

module.exports = { BrokerStatus, createPersistentMqttTransport };
