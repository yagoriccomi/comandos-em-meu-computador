'use strict';
/*
 * Lado do NÚCLEO do named pipe. Aceita uma sessão de desktop autenticada por vez, repassa a ela as
 * ações que precisam de tela e recebe comandos do ícone (pausar, retomar, desligar).
 */
const net = require('net');
const { MAX_SYNC_TIMEOUT_MS } = require('../config/localActions');
const { HANDSHAKE_TIMEOUT_MS, PipeMessage, tokensMatch, attachLineChannel } = require('../desktop/pipeChannel');

/**
 * @param {object} deps
 * @param {string} deps.pipeName
 * @param {string} deps.pipeSecret
 * @param {object} deps.logger
 * @param {() => object} deps.getStatus         estado atual para enviar ao ícone
 * @param {(paused: boolean) => void} deps.onPauseChange
 * @param {() => void} deps.onShutdownRequested
 */
function createDesktopBridge({ pipeName, pipeSecret, logger, getStatus, onPauseChange, onShutdownRequested, executeTimeoutMs = MAX_SYNC_TIMEOUT_MS }) {
    let session;
    let nextRequestId = 1;
    const pending = new Map();

    function failAllPending() {
        for (const settle of pending.values()) settle({ ok: false, reason: 'desktop_disconnected' });
        pending.clear();
    }

    function handleSessionMessage(message) {
        if (message.type === PipeMessage.RESULT && pending.has(message.id)) {
            pending.get(message.id)({ ok: message.ok === true });
            pending.delete(message.id);
        } else if (message.type === PipeMessage.PAUSE || message.type === PipeMessage.RESUME) {
            onPauseChange(message.type === PipeMessage.PAUSE);
            publishStatus();
        } else if (message.type === PipeMessage.SHUTDOWN) {
            logger.info({ event: 'shutdown_requested_by_user' });
            onShutdownRequested();
        }
    }

    function onConnection(socket) {
        let authenticated = false;
        const handshakeTimer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
        const channel = attachLineChannel(socket, (message) => {
            if (!authenticated) {
                if (message.type !== PipeMessage.HELLO || !tokensMatch(pipeSecret, message.token)) {
                    logger.warn({ event: 'desktop_auth_failed' });
                    socket.destroy();
                    return;
                }
                authenticated = true;
                clearTimeout(handshakeTimer);
                if (session) session.socket.destroy(); // a sessão mais recente substitui a anterior
                session = { socket, channel };
                channel.send({ type: PipeMessage.WELCOME });
                channel.send({ type: PipeMessage.STATUS, ...getStatus() });
                logger.info({ event: 'desktop_session_connected' });
                return;
            }
            handleSessionMessage(message);
        });
        socket.on('close', () => {
            clearTimeout(handshakeTimer);
            if (session && session.socket === socket) {
                session = undefined;
                failAllPending();
                logger.info({ event: 'desktop_session_disconnected' });
            }
        });
    }

    const server = net.createServer(onConnection);

    function publishStatus() {
        if (session) session.channel.send({ type: PipeMessage.STATUS, ...getStatus() });
    }

    return {
        listen: () => new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(pipeName, () => {
                server.off('error', reject);
                resolve();
            });
        }),
        close: () => new Promise((resolve) => {
            if (session) session.socket.destroy();
            server.close(() => resolve());
        }),
        publishStatus,
        isConnected: () => Boolean(session),
        /** @returns {Promise<{ ok: boolean, reason?: string }>} nunca rejeita */
        execute(actionId, params) {
            if (!session) return Promise.resolve({ ok: false, reason: 'no_desktop_session' });
            const id = nextRequestId++;
            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    resolve({ ok: false, reason: 'desktop_timeout' });
                }, executeTimeoutMs);
                pending.set(id, (result) => {
                    clearTimeout(timer);
                    resolve(result);
                });
                session.channel.send({ type: PipeMessage.EXECUTE, id, actionId, params });
            });
        },
    };
}

module.exports = { createDesktopBridge };
