'use strict';
/*
 * Envia um comando assinado ao agente e espera o ack assinado correspondente.
 * O transporte é injetado (MQTT em produção, broker em memória nos testes).
 */
const protocol = require('../protocol/message');

const ACK_TIMEOUT_MS = 5000;

const DeliveryResult = Object.freeze({
    DONE: 'done',
    FAILED: 'failed',
    NO_ANSWER: 'no_answer',
});

/**
 * @param {object} options
 * @param {{ publish: Function, subscribe: Function }} options.transport
 * @param {{ deviceId: string, hmacSecret: string }} options.secrets
 * @param {string} options.actionId
 * @param {object} [options.params]
 * @returns {Promise<{ result: string, requestId: string }>}
 */
async function sendCommand({ transport, secrets, actionId, params = {}, timeoutMs = ACK_TIMEOUT_MS, clock = Date.now }) {
    const command = protocol.createCommand({ actionId, params }, secrets.hmacSecret, clock());
    let settle;
    const answer = new Promise((resolve) => { settle = resolve; });
    const timer = setTimeout(() => settle(DeliveryResult.NO_ANSWER), timeoutMs);

    const onAck = (raw) => {
        let ack;
        try {
            ack = protocol.verify(protocol.parse(raw), {
                secret: secrets.hmacSecret,
                expectedType: protocol.MessageType.ACK,
                now: clock(),
            });
        } catch (error) {
            return; // ack forjado, velho ou de outro formato: ignora e continua esperando
        }
        if (ack.requestId !== command.requestId) return;
        settle(ack.status === protocol.AckStatus.OK ? DeliveryResult.DONE : DeliveryResult.FAILED);
    };

    try {
        await transport.subscribe(protocol.ackTopic(secrets.deviceId), onAck);
        await transport.publish(protocol.commandTopic(secrets.deviceId), protocol.serialize(command));
        return { result: await answer, requestId: command.requestId };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { ACK_TIMEOUT_MS, DeliveryResult, sendCommand };
