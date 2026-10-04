'use strict';
/*
 * Cliente do input-helper.ps1: um PowerShell PERSISTENTE na sessão do usuário (o Add-Type de teclas e
 * do menu de mídia do Windows é compilado uma vez só). Fala por linhas: "<verbo> [argumento]" → "ok" | "erro …".
 * Só verbos de uma lista fechada; argumentos são inteiros ou "pasta|executável" validados aqui E no script.
 * Processos são identificados pela PASTA de instalação + nome do .exe (nunca só pelo nome: o claude.exe do
 * app e o do Claude Code, por exemplo, têm o mesmo nome).
 */
const childProcess = require('child_process');
const readline = require('readline');
const { POWERSHELL_EXE } = require('./trayController');

const COMMAND_TIMEOUT_MS = 3000;
const READY_LINE = 'ready';

const HelperVerb = Object.freeze({
    PING: 'ping',
    PLAY_PAUSE: 'playpause',
    MUTE: 'mute',
    VOLUME_UP: 'volup',
    VOLUME_DOWN: 'voldown',
    FULLSCREEN: 'fullscreen',
    EXIT_FULLSCREEN: 'exitfullscreen',
    SEEK: 'seek',
    SKIP: 'skip',
    CLOSE: 'close',
    FORCE_WINDOWLESS: 'forcewindowless',
    KILL: 'kill',
});

const INTEGER_VERBS = Object.freeze([HelperVerb.VOLUME_UP, HelperVerb.VOLUME_DOWN, HelperVerb.SEEK]);
const PROCESS_VERBS = Object.freeze([HelperVerb.CLOSE, HelperVerb.FORCE_WINDOWLESS, HelperVerb.KILL]);
const EXE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,63}\.exe$/i;
// Caminho absoluto de pasta, sem curingas, sem "|" e sem caracteres de controle.
const FOLDER_PATTERN = /^[A-Za-z]:\\[^<>"|?*\u0000-\u001f]{0,240}$/;
const MAX_INTEGER_ARGUMENT = 99999;

class InputHelperError extends Error {
    constructor(code) {
        super(code);
        this.name = 'InputHelperError';
        this.code = code;
    }
}

/** @param {{ folder: string, exe: string }} target */
function isValidProcessTarget(target) {
    return Boolean(target) && typeof target.folder === 'string' && typeof target.exe === 'string'
        && FOLDER_PATTERN.test(target.folder) && EXE_NAME_PATTERN.test(target.exe);
}

/** Monta a linha do comando ou lança InputHelperError — nada fora da lista fechada chega ao PowerShell. */
function formatCommand(verb, argument) {
    if (!Object.values(HelperVerb).includes(verb)) throw new InputHelperError('unknown_verb');
    if (INTEGER_VERBS.includes(verb)) {
        if (!Number.isSafeInteger(argument) || Math.abs(argument) > MAX_INTEGER_ARGUMENT) throw new InputHelperError('invalid_argument');
        return `${verb} ${argument}`;
    }
    if (PROCESS_VERBS.includes(verb)) {
        if (!isValidProcessTarget(argument)) throw new InputHelperError('invalid_argument');
        return `${verb} ${argument.folder}|${argument.exe}`;
    }
    if (argument !== undefined) throw new InputHelperError('invalid_argument');
    return verb;
}

/**
 * @param {object} deps
 * @param {string} deps.scriptPath   input-helper.ps1 instalado
 * @param {object} deps.logger
 */
function createInputHelper({ scriptPath, logger, spawn = childProcess.spawn, timeoutMs = COMMAND_TIMEOUT_MS }) {
    let child;
    let ready;
    let waiting = [];
    let queue = Promise.resolve();

    function stop() {
        if (child) child.kill();
        child = undefined;
        ready = undefined;
        for (const settle of waiting) settle('erro helper_stopped');
        waiting = [];
    }

    function start() {
        child = spawn(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
            shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
        });
        const current = child;
        ready = new Promise((resolve, reject) => {
            const lines = readline.createInterface({ input: current.stdout });
            let isReady = false;
            lines.on('line', (line) => {
                if (!isReady) {
                    if (line.trim() === READY_LINE) {
                        isReady = true;
                        resolve();
                    }
                    return;
                }
                const settle = waiting.shift();
                if (settle) settle(line.trim());
            });
            current.on('error', (error) => {
                logger.warn({ event: 'input_helper_failed', errorCode: error.code });
                reject(new InputHelperError('helper_unavailable'));
            });
            current.on('exit', () => {
                if (child === current) stop();
                if (!isReady) reject(new InputHelperError('helper_unavailable'));
            });
        });
        ready.catch(() => {});
    }

    async function send(line) {
        if (!child) start();
        await ready;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                // Travou (ex.: busca do botão "Pular" demorando): reinicia o ajudante na próxima chamada.
                logger.warn({ event: 'input_helper_timeout', verb: line.split(' ')[0] });
                stop();
                resolve('erro timeout');
            }, timeoutMs);
            waiting.push((reply) => {
                clearTimeout(timer);
                resolve(reply);
            });
            child.stdin.write(`${line}\n`);
        });
    }

    return {
        /** @returns {Promise<string>} "ok…" ou "erro <código>"; nunca rejeita por falha do script */
        run(verb, argument) {
            let line;
            try {
                line = formatCommand(verb, argument);
            } catch (error) {
                return Promise.reject(error);
            }
            const result = queue.then(() => send(line)).catch((error) => `erro ${error.code || 'helper_unavailable'}`);
            queue = result.then(() => undefined);
            return result;
        },
        stop,
    };
}

module.exports = { HelperVerb, InputHelperError, isValidProcessTarget, formatCommand, createInputHelper };
