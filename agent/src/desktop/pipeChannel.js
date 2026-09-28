'use strict';
/*
 * Canal local núcleo ↔ sessão de desktop sobre named pipe: JSON por linha, com tamanho máximo
 * e autenticação MÚTUA por desafio-resposta com segredo compartilhado (config.json). O segredo nunca
 * trafega: cada lado prova que o conhece assinando o nonce do outro. Isso impede que um processo que
 * crie o pipe antes do núcleo (pipe squatting) capture o segredo ou se passe pelo núcleo.
 */
const crypto = require('crypto');

const MAX_LINE_BYTES = 4096;
const HANDSHAKE_TIMEOUT_MS = 2000;
const NONCE_BYTES = 32;
const ProofRole = Object.freeze({ SERVER: 'server', CLIENT: 'client' });

const PipeMessage = Object.freeze({
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
        while (newline !== -1) {
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

module.exports = { MAX_LINE_BYTES, HANDSHAKE_TIMEOUT_MS, PipeMessage, ProofRole, createNonce, computeProof, proofMatches, attachLineChannel };
