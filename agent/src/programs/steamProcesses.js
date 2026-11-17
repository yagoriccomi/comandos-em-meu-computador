'use strict';
/*
 * Jogos da Steam abrem por "steam://rungameid/<id>" e não trazem exe: aqui achamos a pasta do jogo pelo
 * appmanifest das bibliotecas da Steam e listamos os .exe dela, para "fechar" e "destravar" funcionarem.
 */
const fs = require('fs');
const path = require('path');

// ponytail: Steam no caminho padrão; Steam instalada em outro lugar fica sem processos (ler o registro se precisar).
const STEAM_ROOT = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam');
const RUN_GAME_ID = /^steam:\/\/rungameid\/(\d{1,10})$/;
const NOT_THE_GAME = /crash|redist|setup|unins|vc_|dxsetup|prereq|easyanticheat|eac|report|dotnet|runtime|physx/i;
const MAX_DEPTH = 4;
const MAX_EXES = 8;

function steamLibraries() {
    try {
        const vdf = fs.readFileSync(path.join(STEAM_ROOT, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        const found = [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((match) => match[1].replace(/\\\\/g, '\\'));
        return found.length ? found : [STEAM_ROOT];
    } catch {
        return [STEAM_ROOT];
    }
}

function listExes(folder, depth = 0, out = []) {
    if (depth > MAX_DEPTH) return out;
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return out; }
    for (const entry of entries) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) listExes(full, depth + 1, out);
        else if (/\.exe$/i.test(entry.name) && !NOT_THE_GAME.test(entry.name)) out.push({ folder, exe: entry.name });
    }
    return out;
}

/** @returns {{ folder: string, exe: string }[]} vazio quando não é jogo da Steam ou não está instalado */
function steamGameProcesses(appId, libraries = steamLibraries()) {
    const match = RUN_GAME_ID.exec(appId || '');
    if (!match) return [];
    for (const library of libraries) {
        let manifest;
        try { manifest = fs.readFileSync(path.join(library, 'steamapps', `appmanifest_${match[1]}.acf`), 'utf8'); } catch { continue; }
        const installDir = /"installdir"\s+"([^"]+)"/.exec(manifest);
        if (installDir) return listExes(path.join(library, 'steamapps', 'common', installDir[1])).slice(0, MAX_EXES);
    }
    return [];
}

module.exports = { steamGameProcesses };
