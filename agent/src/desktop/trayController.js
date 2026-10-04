'use strict';
/*
 * Inicia o ícone (tray.ps1) e traduz os comandos fixos do menu em ações da sessão de desktop.
 * Cada linha do ícone é "<comando>" ou, só para "rename", "rename <nome digitado>" (validado depois).
 */
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
    PROGRAMS_REFRESH: 'programs_refresh',
    PROGRAMS_EDIT: 'programs_edit',
    RENAME: 'rename',
    ROUTINES: 'routines',
    DEPLOY: 'deploy',
});
const MAX_ARGUMENT_LENGTH = 80;

/**
 * @param {object} deps
 * @param {string} deps.trayScript     caminho do tray.ps1 instalado
 * @param {string} deps.statusFile
 * @param {string} deps.logFile
 * @param {{ pause: Function, resume: Function, shutdownCore: Function }} deps.session
 * @param {() => void} deps.onExit     chamado quando o ícone é fechado
 * @param {Object<string, (argument?: string) => void>} [deps.menuActions]  itens novos do menu (programas, nome, deploy)
 */
function startTray({ trayScript, statusFile, logFile, session, onExit, logger, menuActions = {}, spawn = childProcess.spawn, execFile = childProcess.execFile }) {
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
        ...menuActions,
    };

    readline.createInterface({ input: tray.stdout }).on('line', (line) => {
        const [command, ...rest] = line.trim().split(' ');
        const argument = rest.join(' ').slice(0, MAX_ARGUMENT_LENGTH);
        const handler = Object.prototype.hasOwnProperty.call(handlers, command) ? handlers[command] : undefined;
        if (handler) {
            Promise.resolve().then(() => handler(argument)).catch((error) => logger.warn({ event: 'tray_command_failed', command, errorName: error.name }));
        } else {
            logger.warn({ event: 'unknown_tray_command' });
        }
    });
    tray.on('error', (error) => logger.error({ event: 'tray_failed', errorCode: error.code }));
    tray.on('exit', (code) => logger.info({ event: 'tray_exited', code }));
    return tray;
}

module.exports = { TrayCommand, startTray, POWERSHELL_EXE, NOTEPAD_EXE };
