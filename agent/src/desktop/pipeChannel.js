'use strict';
/*
 * Canal local núcleo ↔ sessão de desktop sobre named pipe: JSON por linha, com tamanho máximo
 * e autenticação por segredo compartilhado (config.json, legível só pelo dono e administradores).
 */
const crypto = require('crypto');

const MAX_LINE_BYTES = 4096;
const HANDSHAKE_TIMEOUT_MS = 2000;

const PipeMessage = Object.freeze({
    HELLO: 'hello',
    WELCOME: 'welcome',
    STATUS: 'status',
    EXECUTE: 'execute',
    RESULT: 'result',
    PAUSE: 'pause',
    RESUME: 'resume',
    SHUTDOWN: 'shutdown',
});

function tokensMatch(expected, received) {
    if (typeof received !== 'string') return false;
    const a = crypto.createHash('sha256').update(expected).digest();
    const b = crypto.createHash('sha256').update(received).digest();
    return crypto.timingSafeEqual(a, b);
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

module.exports = { MAX_LINE_BYTES, HANDSHAKE_TIMEOUT_MS, PipeMessage, tokensMatch, attachLineChannel };
