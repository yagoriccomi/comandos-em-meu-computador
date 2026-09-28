'use strict';
/*
 * Executa uma ação local validada. SEMPRE execFile/spawn com shell: false.
 * O único valor externo que chega aos argumentos é um inteiro já validado contra o catálogo público.
 */
const childProcess = require('child_process');

const MAX_OUTPUT_BYTES = 64 * 1024;
const LOGGED_OUTPUT_CHARS = 2000;

class ExecutionError extends Error {
    constructor(code) {
        super(code);
        this.name = 'ExecutionError';
        this.code = code;
    }
}

function validateParams(publicAction, params) {
    const declared = publicAction.params;
    const received = params && typeof params === 'object' ? Object.keys(params) : [];
    if (received.length !== declared.length) throw new ExecutionError('invalid_params');
    for (const param of declared) {
        const value = params[param.name];
        if (!Number.isSafeInteger(value) || value < param.min || value > param.max) {
            throw new ExecutionError('invalid_params');
        }
    }
}

function buildArgs(localAction, params) {
    validateParams(localAction.publicAction, params);
    return localAction.args.map((arg) => (arg.paramName ? String(params[arg.paramName] * arg.multiplier) : arg.literal));
}

function truncate(text) {
    const value = String(text || '');
    return value.length > LOGGED_OUTPUT_CHARS ? `${value.slice(0, LOGGED_OUTPUT_CHARS)}…` : value;
}

function createActionExecutor({ execFile = childProcess.execFile, spawn = childProcess.spawn, logger }) {
    function runAndWait(localAction, args) {
        return new Promise((resolve) => {
            execFile(localAction.executable, args, {
                shell: false,
                windowsHide: true,
                timeout: localAction.timeoutMs,
                maxBuffer: MAX_OUTPUT_BYTES,
            }, (error, stdout, stderr) => {
                const exitCode = error ? error.code : 0;
                const timedOut = Boolean(error && error.killed);
                const ok = !timedOut && Number.isSafeInteger(exitCode) && localAction.successExitCodes.includes(exitCode);
                // Saída das ações fica SOMENTE no log local (mascarado pelo logger).
                logger.info({ event: 'action_output', actionId: localAction.id, exitCode, timedOut, stdout: truncate(stdout), stderr: truncate(stderr) });
                resolve({ ok });
            });
        });
    }

    function startDetached(localAction, args) {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(localAction.executable, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
            } catch (error) {
                logger.warn({ event: 'action_spawn_failed', actionId: localAction.id, errorCode: error.code });
                resolve({ ok: false });
                return;
            }
            child.once('spawn', () => {
                child.unref();
                resolve({ ok: true });
            });
            child.once('error', (error) => {
                logger.warn({ event: 'action_spawn_failed', actionId: localAction.id, errorCode: error.code });
                resolve({ ok: false });
            });
        });
    }

    /** @returns {Promise<{ ok: boolean }>} nunca rejeita */
    async function execute(localAction, params) {
        if (!localAction || !localAction.enabled) {
            logger.warn({ event: 'action_refused', actionId: localAction && localAction.id, reason: 'action_disabled' });
            return { ok: false };
        }
        let args;
        try {
            args = buildArgs(localAction, params);
        } catch (error) {
            logger.warn({ event: 'action_refused', actionId: localAction.id, reason: error.code || 'invalid_params' });
            return { ok: false };
        }
        return localAction.waitForExit ? runAndWait(localAction, args) : startDetached(localAction, args);
    }

    return { execute };
}

module.exports = { ExecutionError, buildArgs, createActionExecutor };
