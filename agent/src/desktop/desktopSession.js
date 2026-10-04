'use strict';
/*
 * Lado da SESSÃO DO USUÁRIO do canal local (inicia no logon). Executa as ações que precisam de tela,
 * publica o estado para o ícone da bandeja e repassa ao núcleo os comandos do menu.
 */
const fs = require('fs');
const { ChannelMessage, ProofRole, createNonce, computeProof, proofMatches, attachLineChannel, connectToLoopback } = require('./localChannel');

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
 * @param {string} deps.endpointFile   arquivo onde o núcleo publica a porta local
 * @param {string} deps.pipeSecret     segredo do canal local (chave já gravada no config.json)
 * @param {{ get: Function }} deps.localActions
 * @param {{ execute: Function }} deps.executor
 * @param {{ write: Function, notify: Function }} deps.statusWriter
 * @param {object} deps.logger
 */
function createDesktopSession({ endpointFile, pipeSecret, localActions, executor, statusWriter, logger, connect = connectToLoopback, reconnectDelayMs = RECONNECT_DELAY_MS }) {
    let channel;
    let socket;
    let clientNonce;
    let coreProvedSecret = false;
    let welcomed = false;
    let state = TrayState.CORE_DOWN;
    let stopped = false;
    let heartbeat;
    let reconnectTimer;

    function setState(next) {
        state = next;
        statusWriter.write(state);
    }

    async function runDesktopAction(message) {
        const localAction = localActions.get(message.actionId);
        let result = { ok: false };
        if (localAction && localAction.publicAction.requiresDesktop) {
            result = await executor.execute(localAction, message.params);
        } else {
            logger.warn({ event: 'desktop_action_refused', actionId: message.actionId });
        }
        if (channel) {
            channel.send({ type: ChannelMessage.RESULT, id: message.id, ok: result.ok === true, status: result.status, choices: result.choices });
        }
    }

    function onMessage(message) {
        if (message.type === ChannelMessage.CHALLENGE && !coreProvedSecret) {
            // Só responde se o outro lado provou conhecer o segredo: evita falar com um núcleo impostor.
            if (!proofMatches(pipeSecret, ProofRole.SERVER, clientNonce, message.proof)) {
                logger.warn({ event: 'core_auth_failed' });
                socket.destroy();
                return;
            }
            coreProvedSecret = true;
            channel.send({ type: ChannelMessage.AUTH, proof: computeProof(pipeSecret, ProofRole.CLIENT, message.nonce) });
        } else if (message.type === ChannelMessage.WELCOME && coreProvedSecret) {
            // "welcome" só vale depois de o núcleo ter provado o segredo no desafio.
            welcomed = true;
            logger.info({ event: 'connected_to_core' });
        } else if (message.type === ChannelMessage.STATUS && welcomed) {
            setState(stateFromCoreStatus(message));
        } else if (message.type === ChannelMessage.EXECUTE && welcomed) {
            runDesktopAction(message).catch((error) => logger.error({ event: 'desktop_action_crashed', errorName: error.name }));
        }
    }

    function scheduleReconnect() {
        setState(TrayState.CORE_DOWN);
        reconnectTimer = setTimeout(connectToCore, reconnectDelayMs);
    }

    function connectToCore() {
        if (stopped) return;
        try {
            socket = connect(endpointFile);
        } catch (error) {
            // Núcleo ainda não publicou a porta (não iniciou ou parou): tenta de novo depois.
            scheduleReconnect();
            return;
        }
        socket.on('connect', () => {
            clientNonce = createNonce();
            coreProvedSecret = false;
            channel = attachLineChannel(socket, onMessage);
            channel.send({ type: ChannelMessage.HELLO, nonce: clientNonce });
        });
        socket.on('error', () => {});
        socket.on('close', () => {
            const wasConnected = welcomed;
            channel = undefined;
            welcomed = false;
            coreProvedSecret = false;
            if (stopped) return;
            if (wasConnected) {
                logger.warn({ event: 'core_connection_lost' });
                statusWriter.notify(Notice.CORE_STOPPED, TrayState.CORE_DOWN);
            }
            scheduleReconnect();
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
            clearTimeout(reconnectTimer);
            if (socket) socket.destroy();
        },
        getState: () => state,
        isConnected: () => welcomed,
        pause: () => sendToCore(ChannelMessage.PAUSE),
        resume: () => sendToCore(ChannelMessage.RESUME),
        shutdownCore: () => sendToCore(ChannelMessage.SHUTDOWN),
    };
}

module.exports = { TrayState, Notice, createStatusFileWriter, createDesktopSession };
