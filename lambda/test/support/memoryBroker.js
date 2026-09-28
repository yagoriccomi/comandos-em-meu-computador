'use strict';
/* Broker em memória com a mesma interface do transporte MQTT, para testes sem rede. */
function createMemoryBroker() {
    const subscribers = new Map();
    const published = [];

    function connect() {
        return {
            async subscribe(topic, onMessage) {
                if (!subscribers.has(topic)) subscribers.set(topic, new Set());
                subscribers.get(topic).add(onMessage);
            },
            async publish(topic, payload) {
                published.push({ topic, payload: String(payload) });
                for (const onMessage of subscribers.get(topic) || []) {
                    setImmediate(() => onMessage(Buffer.from(String(payload))));
                }
            },
            async close() {},
        };
    }

    return { connect, published };
}

module.exports = { createMemoryBroker };
