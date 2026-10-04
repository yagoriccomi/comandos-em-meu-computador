'use strict';
/*
 * Lado do NÚCLEO do canal local (127.0.0.1). Aceita uma sessão de desktop autenticada por vez, repassa
 * a ela as ações que precisam de tela e recebe comandos do ícone (pausar, retomar, desligar).
 */
const net = require('net');
const { protocol } = require('../shared');

const DETAILED_STATUSES = Object.freeze([
    protocol.AckStatus.AMBIGUOUS, protocol.AckStatus.NOT_FOUND, protocol.AckStatus.PENDING, protocol.AckStatus.PIN_REQUIRED, protocol.AckStatus.LOCKED,
]);

function isValidSpeechText(text) {
    return typeof text === 'string' && text.length > 0 && text.length <= protocol.MAX_ACK_TEXT_LENGTH && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text);
}

/** Resultado vindo da sessão: ok (com resumo opcional), ou um status detalhado com opções que o protocolo aceita. */
function sanitizeResult(message) {
    if (message.ok === true) return isValidSpeechText(message.text) ? { ok: true, text: message.text } : { ok: true };
    if (!DETAILED_STATUSES.includes(message.status)) return { ok: false };
    const choices = Array.isArray(message.choices)
        ? message.choices.filter((choice) => protocol.isValidTextParam(choice) && choice.length <= protocol.MAX_CHOICE_LENGTH)
            .slice(0, protocol.MAX_ACK_CHOICES)
        : [];
    return { ok: false, status: message.status, choices };
}
const { MAX_SYNC_TIMEOUT_MS } = require('../config/localActions');
const {
    HANDSHAKE_TIMEOUT_MS, ChannelMessage, ProofRole, createNonce, computeProof, proofMatches, attachLineChannel, listenOnLoopback,
} = require('../desktop/localChannel');

/**
 * @param {object} deps
 * @param {string} deps.endpointFile   onde a porta escolhida é publicada para a sessão de desktop
 * @param {string} deps.pipeSecret     segredo do canal local (nome mantido: é a chave já gravada no config.json)
 * @param {object} deps.logger
 * @param {() => object} deps.getStatus         estado atual para enviar ao ícone
 * @param {(paused: boolean) => void} deps.onPauseChange
 * @param {() => void} deps.onShutdownRequested
 */
function createDesktopBridge({ endpointFile, pipeSecret, logger, getStatus, onPauseChange, onShutdownRequested, executeTimeoutMs = MAX_SYNC_TIMEOUT_MS }) {
    let session;
    let nextRequestId = 1;
    const pending = new Map();

    function failAllPending() {
        for (const settle of pending.values()) settle({ ok: false, reason: 'desktop_disconnected' });
        pending.clear();
    }

    function handleSessionMessage(message) {
        if (message.type === ChannelMessage.RESULT && pending.has(message.id)) {
            pending.get(message.id)(sanitizeResult(message));
            pending.delete(message.id);
        } else if (message.type === ChannelMessage.PAUSE || message.type === ChannelMessage.RESUME) {
            onPauseChange(message.type === ChannelMessage.PAUSE);
            publishStatus();
        } else if (message.type === ChannelMessage.SHUTDOWN) {
            logger.info({ event: 'shutdown_requested_by_user' });
            onShutdownRequested();
        }
    }

    const openSockets = new Set();

    function onConnection(socket) {
        openSockets.add(socket);
        socket.on('close', () => openSockets.delete(socket));
        let authenticated = false;
        let serverNonce;
        const handshakeTimer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
        const rejectSession = () => {
            logger.warn({ event: 'desktop_auth_failed' });
            socket.destroy();
        };
        const channel = attachLineChannel(socket, (message) => {
            if (!authenticated && !serverNonce) {
                if (message.type !== ChannelMessage.HELLO || typeof message.nonce !== 'string') return rejectSession();
                serverNonce = createNonce();
                channel.send({ type: ChannelMessage.CHALLENGE, nonce: serverNonce, proof: computeProof(pipeSecret, ProofRole.SERVER, message.nonce) });
                return undefined;
            }
            if (!authenticated) {
                if (message.type !== ChannelMessage.AUTH || !proofMatches(pipeSecret, ProofRole.CLIENT, serverNonce, message.proof)) {
                    return rejectSession();
                }
                authenticated = true;
                clearTimeout(handshakeTimer);
                if (session) session.socket.destroy(); // a sessão mais recente substitui a anterior
                session = { socket, channel };
                channel.send({ type: ChannelMessage.WELCOME });
                channel.send({ type: ChannelMessage.STATUS, ...getStatus() });
                logger.info({ event: 'desktop_session_connected' });
                return undefined;
            }
            return handleSessionMessage(message);
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
        if (session) session.channel.send({ type: ChannelMessage.STATUS, ...getStatus() });
    }

    return {
        listen: () => listenOnLoopback(server, endpointFile),
        close: () => new Promise((resolve) => {
            for (const socket of openSockets) socket.destroy(); // inclui conexões ainda não autenticadas
            server.close(() => resolve());
        }),
        publishStatus,
        isConnected: () => Boolean(session),
        /** @returns {Promise<{ ok: boolean, reason?: string, status?: string, choices?: string[] }>} nunca rejeita */
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
                session.channel.send({ type: ChannelMessage.EXECUTE, id, actionId, params });
            });
        },
    };
}

module.exports = { createDesktopBridge };
