'use strict';
/*
 * Gera o hash SHA-256 do userId da Alexa para a allowlist opcional (allowedUserIdHashes em secrets.json).
 * Onde achar o userId: console da Alexa → Test → JSON Input → context.System.user.userId.
 * Uso: node scripts/hash-user-id.js "amzn1.ask.account.XXXX"
 */
const { hashUserId } = require('../handlers/actionHandler');

const [userId] = process.argv.slice(2);
if (!userId || !userId.startsWith('amzn1.ask.account.')) {
    console.error('Informe o userId completo (começa com amzn1.ask.account.).');
    process.exitCode = 1;
} else {
    console.log(hashUserId(userId));
}
