'use strict';
/* Arquivos embutidos no .exe (Single Executable Application) ou lidos do repositório em desenvolvimento. */
const fs = require('fs');
const path = require('path');

const DEV_ASSET_PATHS = Object.freeze({
    'tray.ps1': path.join(__dirname, 'desktop', 'tray.ps1'),
    'actions.example.json': path.join(__dirname, '..', 'config', 'actions.example.json'),
});

function getSea() {
    try {
        const sea = require('node:sea');
        return sea.isSea() ? sea : undefined;
    } catch (error) {
        return undefined;
    }
}

function isPackagedExe() {
    return Boolean(getSea());
}

function readAsset(name) {
    if (!DEV_ASSET_PATHS[name]) throw new Error(`asset desconhecido: ${name}`);
    const sea = getSea();
    return sea ? sea.getAsset(name, 'utf8') : fs.readFileSync(DEV_ASSET_PATHS[name], 'utf8');
}

module.exports = { DEV_ASSET_PATHS, isPackagedExe, readAsset };
