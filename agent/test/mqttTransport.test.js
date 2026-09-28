'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createPersistentMqttTransport, BrokerStatus } = require('../src/transport/mqttTransport');

function fakeMqttLib() {
    const client = new EventEmitter();
    client.connected = false;
    client.subscriptions = [];
    client.subscribe = (topic, options, callback) => { client.subscriptions.push(topic); callback(null); };
    client.subscribeAsync = async (topic) => { client.subscriptions.push(topic); };
    const lib = { connect: (url, options) => { lib.options = { url, ...options }; return client; } };
    return { lib, client };
}

const silentLogger = { info() {}, warn() {}, error() {} };

test('shouldRequireTlsCertificateValidationAndAutoReconnect', () => {
    const { lib } = fakeMqttLib();
    createPersistentMqttTransport({ url: 'mqtts://b:8883', username: 'u', password: 'p', clientId: 'pc-x', logger: silentLogger, mqttLib: lib });
    assert.equal(lib.options.rejectUnauthorized, true);
    assert.ok(lib.options.reconnectPeriod > 0);
});

test('shouldSubscribeAgainAfterReconnectAndReportStatus', async () => {
    const { lib, client } = fakeMqttLib();
    const statuses = [];
    const transport = createPersistentMqttTransport({ url: 'mqtts://b:8883', username: 'u', password: 'p', clientId: 'pc-x',
        logger: silentLogger, mqttLib: lib, onStatus: (status) => statuses.push(status) });
    await transport.subscribe('omonstro/pc-teste-1234/cmd', () => {});
    client.emit('connect');
    client.emit('offline');
    client.emit('connect');
    assert.deepEqual(client.subscriptions, ['omonstro/pc-teste-1234/cmd', 'omonstro/pc-teste-1234/cmd']);
    assert.deepEqual(statuses, [BrokerStatus.CONNECTING, BrokerStatus.CONNECTED, BrokerStatus.OFFLINE, BrokerStatus.CONNECTED]);
});

test('shouldDeliverMessagesOnlyToRegisteredTopic', async () => {
    const { lib, client } = fakeMqttLib();
    const received = [];
    const transport = createPersistentMqttTransport({ url: 'mqtts://b:8883', username: 'u', password: 'p', clientId: 'pc-x', logger: silentLogger, mqttLib: lib });
    await transport.subscribe('a/cmd', (payload) => received.push(String(payload)));
    client.emit('message', 'a/cmd', Buffer.from('1'));
    client.emit('message', 'outro/topico', Buffer.from('2'));
    assert.deepEqual(received, ['1']);
});
