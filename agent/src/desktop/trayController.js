'use strict';
/* Inicia o ícone (tray.ps1) e traduz os comandos fixos do menu em ações da sessão de desktop. */
const childProcess = require('child_process');
const path = require('path');
const readline = require('readline');

const POWERSHELL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const NOTEPAD_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');

const TrayCommand = Object.freeze({
    PAUSE: 'pause',
    RESUME: 'resume',
    OPEN_LOG: 'openlog',
    SHUTDOWN: 'shutdown',
    QUIT: 'quit',
});

/**
 * @param {object} deps
 * @param {string} deps.trayScript     caminho do tray.ps1 instalado
 * @param {string} deps.statusFile
 * @param {string} deps.logFile
 * @param {{ pause: Function, resume: Function, shutdownCore: Function }} deps.session
 * @param {() => void} deps.onExit     chamado quando o ícone é fechado
 */
function startTray({ trayScript, statusFile, logFile, session, onExit, logger, spawn = childProcess.spawn, execFile = childProcess.execFile }) {
    const tray = spawn(POWERSHELL_EXE, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', trayScript, '-StatusFile', statusFile, '-ParentPid', String(process.pid),
    ], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

    const handlers = {
        [TrayCommand.PAUSE]: () => session.pause(),
        [TrayCommand.RESUME]: () => session.resume(),
        [TrayCommand.OPEN_LOG]: () => execFile(NOTEPAD_EXE, [logFile], { shell: false }, () => {}),
        [TrayCommand.SHUTDOWN]: () => {
            if (session.shutdownCore()) onExit();
        },
        [TrayCommand.QUIT]: () => onExit(),
    };

    readline.createInterface({ input: tray.stdout }).on('line', (line) => {
        const handler = handlers[line.trim()];
        if (handler) {
            handler();
        } else {
            logger.warn({ event: 'unknown_tray_command' });
        }
    });
    tray.on('error', (error) => logger.error({ event: 'tray_failed', errorCode: error.code }));
    tray.on('exit', (code) => logger.info({ event: 'tray_exited', code }));
    return tray;
}

module.exports = { TrayCommand, startTray, POWERSHELL_EXE };
