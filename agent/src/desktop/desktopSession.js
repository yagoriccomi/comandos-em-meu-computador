'use strict';
/*
 * Lado da SESSÃO DO USUÁRIO do named pipe (inicia no logon). Executa as ações que precisam de tela,
 * publica o estado para o ícone da bandeja e repassa ao núcleo os comandos do menu.
 */
const fs = require('fs');
const net = require('net');
const { PipeMessage, attachLineChannel } = require('./pipeChannel');

const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_MS = 5000;

const TrayState = Object.freeze({
    READY: 'ready',
    PAUSED: 'paused',
    OFFLINE: 'offline',
    CORE_DOWN: 'core_down',
});

const Notice = Object.freeze({
    CORE_UNREACHABLE: 'Não consegui falar com o núcleo do agente. Veja o log.',
    CORE_STOPPED: 'O núcleo do agente parou. Os comandos da Alexa não serão executados.',
});

function createStatusFileWriter(filePath, clock = Date.now) {
    let lastNotice;
    let noticeCounter = 0;
    return {
        write(state) {
            const content = { state, updatedAt: clock(), notice: lastNotice };
            try {
                fs.writeFileSync(filePath, JSON.stringify(content));
            } catch (error) {
                // O ícone continua mostrando o último estado conhecido.
            }
        },
        notify(text, state) {
            noticeCounter += 1;
            lastNotice = { id: noticeCounter, text };
            this.write(state);
        },
    };
}

function stateFromCoreStatus(status) {
    if (status.paused) return TrayState.PAUSED;
    return status.broker === 'connected' ? TrayState.READY : TrayState.OFFLINE;
}

/**
 * @param {object} deps
 * @param {string} deps.pipeName
 * @param {string} deps.pipeSecret
 * @param {{ get: Function }} deps.localActions
 * @param {{ execute: Function }} deps.executor
 * @param {{ write: Function, notify: Function }} deps.statusWriter
 * @param {object} deps.logger
 */
function createDesktopSession({ pipeName, pipeSecret, localActions, executor, statusWriter, logger, connect = net.connect, reconnectDelayMs = RECONNECT_DELAY_MS }) {
    let channel;
    let welcomed = false;
    let state = TrayState.CORE_DOWN;
    let stopped = false;
    let heartbeat;

    function setState(next) {
        state = next;
        statusWriter.write(state);
    }

    async function runDesktopAction(message) {
        const localAction = localActions.get(message.actionId);
        let ok = false;
        if (localAction && localAction.publicAction.requiresDesktop) {
            ok = (await executor.execute(localAction, message.params)).ok;
        } else {
            logger.warn({ event: 'desktop_action_refused', actionId: message.actionId });
        }
        if (channel) channel.send({ type: PipeMessage.RESULT, id: message.id, ok });
    }

    function onMessage(message) {
        if (message.type === PipeMessage.WELCOME) {
            welcomed = true;
            logger.info({ event: 'connected_to_core' });
        } else if (message.type === PipeMessage.STATUS && welcomed) {
            setState(stateFromCoreStatus(message));
        } else if (message.type === PipeMessage.EXECUTE && welcomed) {
            runDesktopAction(message).catch((error) => logger.error({ event: 'desktop_action_crashed', errorName: error.name }));
        }
    }

    function connectToCore() {
        if (stopped) return;
        const socket = connect(pipeName);
        socket.on('connect', () => {
            channel = attachLineChannel(socket, onMessage);
            channel.send({ type: PipeMessage.HELLO, token: pipeSecret });
        });
        socket.on('error', () => {});
        socket.on('close', () => {
            const wasConnected = welcomed;
            channel = undefined;
            welcomed = false;
            if (stopped) return;
            if (wasConnected) {
                logger.warn({ event: 'core_connection_lost' });
                statusWriter.notify(Notice.CORE_STOPPED, TrayState.CORE_DOWN);
            }
            setState(TrayState.CORE_DOWN);
            setTimeout(connectToCore, reconnectDelayMs);
        });
    }

    /** Envia um comando do menu ao núcleo; sem conexão, avisa o usuário pelo balão. */
    function sendToCore(type) {
        if (!channel || !welcomed) {
            logger.warn({ event: 'menu_command_failed', command: type, reason: 'core_unreachable' });
            statusWriter.notify(Notice.CORE_UNREACHABLE, state);
            return false;
        }
        channel.send({ type });
        return true;
    }

    return {
        start() {
            setState(TrayState.CORE_DOWN);
            heartbeat = setInterval(() => statusWriter.write(state), HEARTBEAT_MS);
            connectToCore();
        },
        stop() {
            stopped = true;
            clearInterval(heartbeat);
        },
        getState: () => state,
        isConnected: () => welcomed,
        pause: () => sendToCore(PipeMessage.PAUSE),
        resume: () => sendToCore(PipeMessage.RESUME),
        shutdownCore: () => sendToCore(PipeMessage.SHUTDOWN),
    };
}

module.exports = { TrayState, Notice, createStatusFileWriter, createDesktopSession };
