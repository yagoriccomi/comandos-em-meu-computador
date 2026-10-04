'use strict';
/* Caminhos fixos do agente. OMONSTRO_DATA_DIR só existe para testes e desenvolvimento. */
const path = require('path');

const APP_FOLDER = 'OMonstro';
const DATA_DIR = process.env.OMONSTRO_DATA_DIR
    || path.join(process.env.ProgramData || 'C:\\ProgramData', APP_FOLDER);
const INSTALL_DIR = path.join(process.env.ProgramFiles || 'C:\\Program Files', APP_FOLDER);
// Pasta PRIVADA do usuário (só a sessão de desktop usa): lista de programas e preferências. Fora do Git.
const USER_DATA_DIR = process.env.OMONSTRO_USER_DATA_DIR
    || path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local'), APP_FOLDER);

// Repositório de onde o pacote foi gerado (o build grava o caminho): o deploy roda o script de lá.
const REPO_DIR = process.env.OMONSTRO_REPO_DIR || path.resolve(__dirname, '..', '..', '..');

module.exports = Object.freeze({
    REPO_DIR,
    DEPLOY_SCRIPT: path.join(REPO_DIR, 'scripts', 'deploy.ps1'),
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
    INPUT_HELPER_SCRIPT: path.join(INSTALL_DIR, 'input-helper.ps1'),
    SCAN_PROGRAMS_SCRIPT: path.join(INSTALL_DIR, 'scan-programs.ps1'),
    USER_DATA_DIR,
    PROGRAMS_FILE: path.join(USER_DATA_DIR, 'programas.json'),
    PREFERENCES_FILE: path.join(USER_DATA_DIR, 'preferencias.json'),
    ROUTINES_FILE: path.join(USER_DATA_DIR, 'rotinas-sugeridas.txt'),
    LOG_DIR: path.join(DATA_DIR, 'logs'),
    ALEXA_EXPORT_DIR: path.join(DATA_DIR, 'enviar-para-alexa'),
    // Porta (aleatória, só 127.0.0.1) onde o núcleo espera a sessão de desktop. Legível só por você e admins.
    CORE_ENDPOINT_FILE: path.join(DATA_DIR, 'core-endpoint.json'),
});
