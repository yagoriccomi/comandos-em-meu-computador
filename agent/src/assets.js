'use strict';
/*
 * Arquivos que acompanham o agente. Instalado, o agente roda como `node.exe o-monstro.cjs` (Node oficial,
 * assinado) e os arquivos ficam na mesma pasta do bundle; em desenvolvimento, vêm do repositório.
 */
const fs = require('fs');
const path = require('path');

const APP_BUNDLE_NAME = 'o-monstro.cjs';
const NODE_RUNTIME_NAME = 'node.exe';
const PACKAGED_FILES = Object.freeze([NODE_RUNTIME_NAME, APP_BUNDLE_NAME, 'tray.ps1', 'actions.example.json']);

const DEV_ASSET_PATHS = Object.freeze({
    'tray.ps1': path.join(__dirname, 'desktop', 'tray.ps1'),
    'actions.example.json': path.join(__dirname, '..', 'config', 'actions.example.json'),
});

function currentAppFile() {
    return (require.main && require.main.filename) || '';
}

/** true quando rodando a partir do pacote (dist ou Program Files), e não do código-fonte. */
function isPackagedInstall() {
    return path.basename(currentAppFile()).toLowerCase() === APP_BUNDLE_NAME;
}

function packageDirectory() {
    return path.dirname(currentAppFile());
}

function readAsset(name) {
    if (!DEV_ASSET_PATHS[name]) throw new Error(`asset desconhecido: ${name}`);
    const filePath = isPackagedInstall() ? path.join(packageDirectory(), name) : DEV_ASSET_PATHS[name];
    return fs.readFileSync(filePath, 'utf8');
}

module.exports = {
    APP_BUNDLE_NAME,
    NODE_RUNTIME_NAME,
    PACKAGED_FILES,
    DEV_ASSET_PATHS,
    currentAppFile,
    isPackagedInstall,
    packageDirectory,
    readAsset,
};
