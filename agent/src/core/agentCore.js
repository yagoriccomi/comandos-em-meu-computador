'use strict';
/*
 * Núcleo do agente: recebe cmd do broker, valida, executa (localmente ou na sessão de desktop)
 * e publica o ack assinado. Nunca lança: qualquer falha vira ack "error" e log local.
 */
const { protocol } = require('../shared');

/**
 * @param {object} deps
 * @param {{ deviceId: string, hmacSecret: string }} deps.config
 * @param {{ subscribe: Function, publish: Function }} deps.transport
 * @param {{ inspect: Function }} deps.guard
 * @param {{ get: Function }} deps.localActions
 * @param {{ execute: Function }} deps.executor
 * @param {{ execute: Function }} deps.desktopBridge
 * @param {{ isPaused: Function }} deps.pauseState
 * @param {object} deps.logger
 */
function createAgentCore({ config, transport, guard, localActions, executor, desktopBridge, pauseState, logger, clock = Date.now }) {
    /** ok → "ok"; busca de programa sem vencedor → "ambiguous"/"not_found" com opções; resto → "error". */
    async function sendAck(requestId, result) {
        let reply = { status: result.ok ? protocol.AckStatus.OK : protocol.AckStatus.ERROR };
        if (result.ok && result.text) reply = { status: protocol.AckStatus.OK, text: result.text };
        if (!result.ok && result.status) reply = { status: result.status, choices: result.choices || [] };
        const ack = protocol.createAck({ requestId, ...reply }, config.hmacSecret, clock());
        await transport.publish(protocol.ackTopic(config.deviceId), protocol.serialize(ack));
    }

    async function runCommand(command) {
        if (pauseState.isPaused()) return { ok: false, reason: 'paused' };
        const localAction = localActions.get(command.actionId);
        if (!localAction) return { ok: false, reason: 'not_configured' };
        if (localAction.publicAction.requiresDesktop) {
            return desktopBridge.execute(command.actionId, command.params);
        }
        return executor.execute(localAction, command.params);
    }

    async function handleMessage(raw) {
        const inspection = guard.inspect(raw);
        if (!inspection.ok) {
            logger.warn({ event: 'command_rejected', reason: inspection.reason });
            // Só responde a mensagens autênticas; mensagens forjadas não recebem nenhum retorno.
            if (inspection.command) await sendAck(inspection.command.requestId, { ok: false });
            return;
        }
        const { command } = inspection;
        let result;
        try {
            result = await runCommand(command);
        } catch (error) {
            result = { ok: false, reason: 'unexpected_error' };
            logger.error({ event: 'command_crashed', actionId: command.actionId, errorName: error.name });
        }
        logger.info({ event: 'command_handled', actionId: command.actionId, requestId: command.requestId, ok: result.ok, reason: result.reason });
        await sendAck(command.requestId, result);
    }

    return {
        handleMessage,
        async start() {
            await transport.subscribe(protocol.commandTopic(config.deviceId), (raw) => {
                handleMessage(raw).catch((error) => logger.error({ event: 'ack_failed', errorName: error.name }));
            });
            logger.info({ event: 'core_started' });
        },
    };
}

module.exports = { createAgentCore };
