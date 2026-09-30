'use strict';
/*
 * Canal local núcleo ↔ sessão de desktop: TCP só em 127.0.0.1 (porta aleatória publicada em
 * core-endpoint.json), JSON por linha, com tamanho máximo e autenticação MÚTUA por desafio-resposta com
 * segredo compartilhado (config.json). O segredo nunca trafega: cada lado prova que o conhece assinando
 * o nonce do outro, então um processo que ocupe a porta ou se conecte a ela não obtém nem manda nada.
 *
 * Por que não named pipe: o núcleo roda em logon S4U (antes do logon do usuário) e o Windows dá ao pipe
 * criado nessa sessão uma DACL que a sessão interativa do mesmo usuário não consegue abrir (EPERM).
 */
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');

const LOOPBACK_HOST = '127.0.0.1';
const MAX_LINE_BYTES = 4096;
const HANDSHAKE_TIMEOUT_MS = 2000;
const NONCE_BYTES = 32;
const ProofRole = Object.freeze({ SERVER: 'server', CLIENT: 'client' });

const ChannelMessage = Object.freeze({
    HELLO: 'hello',
    CHALLENGE: 'challenge',
    AUTH: 'auth',
    WELCOME: 'welcome',
    STATUS: 'status',
    EXECUTE: 'execute',
    RESULT: 'result',
    PAUSE: 'pause',
    RESUME: 'resume',
    SHUTDOWN: 'shutdown',
});

function createNonce() {
    return crypto.randomBytes(NONCE_BYTES).toString('hex');
}

function computeProof(secret, role, nonce) {
    return crypto.createHmac('sha256', secret).update(`${role}:${nonce}`).digest('hex');
}

function proofMatches(secret, role, nonce, receivedProof) {
    if (typeof receivedProof !== 'string' || typeof nonce !== 'string') return false;
    const expected = Buffer.from(computeProof(secret, role, nonce));
    const received = Buffer.from(receivedProof);
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/** Envolve um socket: onMessage(objeto) por linha; fecha a conexão em linha grande ou JSON inválido. */
function attachLineChannel(socket, onMessage) {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES && !buffer.includes('\n')) {
            socket.destroy();
            return;
        }
        let newline = buffer.indexOf('\n');
        // Parar assim que a conexão for derrubada: linhas já recebidas de um par recusado não podem ser processadas.
        while (newline !== -1 && !socket.destroyed) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            let message;
            try {
                message = JSON.parse(line);
            } catch (error) {
                socket.destroy();
                return;
            }
            if (message && typeof message === 'object') onMessage(message);
            newline = buffer.indexOf('\n');
        }
    });
    socket.on('error', () => socket.destroy());
    return {
        send(message) {
            if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
        },
    };
}

/** Núcleo: escuta em 127.0.0.1 numa porta livre e publica a porta no arquivo de endpoint. */
function listenOnLoopback(server, endpointFile) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: LOOPBACK_HOST, port: 0 }, () => {
            server.off('error', reject);
            const { port } = server.address();
            fs.writeFileSync(endpointFile, JSON.stringify({ port, pid: process.pid }));
            resolve(port);
        });
    });
}

/** Sessão de desktop: lê a porta publicada pelo núcleo e conecta em 127.0.0.1. */
function connectToLoopback(endpointFile) {
    const { port } = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('endpoint inválido');
    return net.connect({ host: LOOPBACK_HOST, port });
}

module.exports = {
    LOOPBACK_HOST,
    MAX_LINE_BYTES,
    HANDSHAKE_TIMEOUT_MS,
    ChannelMessage,
    ProofRole,
    createNonce,
    computeProof,
    proofMatches,
    attachLineChannel,
    listenOnLoopback,
    connectToLoopback,
};
