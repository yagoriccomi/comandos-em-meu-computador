'use strict';
/* Caminhos fixos do agente. OMONSTRO_DATA_DIR só existe para testes e desenvolvimento. */
const path = require('path');

const APP_FOLDER = 'OMonstro';
const DATA_DIR = process.env.OMONSTRO_DATA_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', APP_FOLDER);
const INSTALL_DIR = path.join(process.env.ProgramFiles || 'C:\\Program Files', APP_FOLDER);

module.exports = Object.freeze({
    APP_FOLDER,
    DATA_DIR,
    INSTALL_DIR,
    INSTALLED_NODE: path.join(INSTALL_DIR, 'node.exe'),
    INSTALLED_APP: path.join(INSTALL_DIR, 'o-monstro.cjs'),
    UNINSTALL_SCRIPT: path.join(INSTALL_DIR, 'Desinstalar O Monstro.cmd'),
    CONFIG_FILE: path.join(DATA_DIR, 'config.json'),
    ACTIONS_FILE: path.join(DATA_DIR, 'actions.json'),
    STATE_FILE: path.join(DATA_DIR, 'state.json'),
    STATUS_FILE: path.join(DATA_DIR, 'status.json'),
    TRAY_SCRIPT: path.join(INSTALL_DIR, 'tray.ps1'),
    LOG_DIR: path.join(DATA_DIR, 'logs'),
    ALEXA_EXPORT_DIR: path.join(DATA_DIR, 'enviar-para-alexa'),
    PIPE_NAME: process.env.OMONSTRO_PIPE_NAME || '\\\\.\\pipe\\o-monstro',
});
