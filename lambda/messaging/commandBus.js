'use strict';
/*
 * Envia um comando assinado ao agente e espera o ack assinado correspondente.
 * O transporte é injetado (MQTT em produção, broker em memória nos testes).
 */
const protocol = require('../protocol/message');

// Orçamento total da Alexa ≈ 8 s: conexão (≤ 2,5 s) + espera do ack (≤ 4,5 s) + margem.
const ACK_TIMEOUT_MS = 4500;

const DeliveryResult = Object.freeze({
    DONE: 'done',
    FAILED: 'failed',
    NO_ANSWER: 'no_answer',
    AMBIGUOUS: 'ambiguous',
    NOT_FOUND: 'not_found',
    PENDING: 'pending',
    PIN_REQUIRED: 'pin_required',
    LOCKED: 'locked',
    CHAT_CHOICE: 'chat_choice',
});

const RESULT_BY_ACK_STATUS = Object.freeze({
    [protocol.AckStatus.OK]: DeliveryResult.DONE,
    [protocol.AckStatus.ERROR]: DeliveryResult.FAILED,
    [protocol.AckStatus.AMBIGUOUS]: DeliveryResult.AMBIGUOUS,
    [protocol.AckStatus.NOT_FOUND]: DeliveryResult.NOT_FOUND,
    [protocol.AckStatus.PENDING]: DeliveryResult.PENDING,
    [protocol.AckStatus.PIN_REQUIRED]: DeliveryResult.PIN_REQUIRED,
    [protocol.AckStatus.LOCKED]: DeliveryResult.LOCKED,
    [protocol.AckStatus.CHAT_CHOICE]: DeliveryResult.CHAT_CHOICE,
});

/**
 * @param {object} options
 * @param {{ publish: Function, subscribe: Function }} options.transport
 * @param {{ deviceId: string, hmacSecret: string }} options.secrets
 * @param {string} options.actionId
 * @param {object} [options.params]
 * @returns {Promise<{ result: string, requestId: string, choices: string[], text?: string }>}
 */
async function sendCommand({ transport, secrets, actionId, params = {}, timeoutMs = ACK_TIMEOUT_MS, clock = Date.now }) {
    const command = protocol.createCommand({ actionId, params }, secrets.hmacSecret, clock());
    let settle;
    const answer = new Promise((resolve) => { settle = resolve; });
    const timer = setTimeout(() => settle({ result: DeliveryResult.NO_ANSWER, choices: [] }), timeoutMs);

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
        settle({ result: RESULT_BY_ACK_STATUS[ack.status], choices: ack.choices || [], text: ack.text });
    };

    try {
        await transport.subscribe(protocol.ackTopic(secrets.deviceId), onAck);
        await transport.publish(protocol.commandTopic(secrets.deviceId), protocol.serialize(command));
        const { result, choices, text } = await answer;
        return { result, choices, text, requestId: command.requestId };
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { ACK_TIMEOUT_MS, DeliveryResult, sendCommand };
