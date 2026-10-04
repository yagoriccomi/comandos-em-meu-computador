'use strict';
/*
 * Lado "menu da bandeja" da lista privada: detectar de novo, ler com cache, preferências (nome de chamada)
 * e a lista de rotinas sugeridas para o app Alexa. Roda na sessão do usuário.
 */
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { POWERSHELL_EXE } = require('../desktop/trayController');
const { loadProgramList, saveProgramList, mergeDetected } = require('./programList');

const SCAN_TIMEOUT_MS = 120 * 1000;
const SCAN_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_INVOCATION_NAME = 'o monstro';
// "o monstro", "a Morgana", "morgana", "o pc gamer": artigo opcional + 1 a 3 palavras só com letras.
const INVOCATION_NAME_PATTERN = /^((o|a) )?[a-zà-ú]{2,20}( [a-zà-ú]{2,20}){0,2}$/;

class ProgramsManagerError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProgramsManagerError';
    }
}

function normalizeInvocationName(value) {
    const name = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return INVOCATION_NAME_PATTERN.test(name) ? name : undefined;
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
    } catch (error) {
        return undefined;
    }
}

/** Texto com as rotinas sugeridas: frase curta no app Alexa → ação personalizada "pede para <nome> …". */
function buildRoutineSuggestions(list, invocationName) {
    const lines = [
        'Rotinas sugeridas para o app Alexa (Mais → Rotinas → +).',
        'Em "Quando isso acontecer" escolha "Voz" e digite a FRASE; em "Adicionar ação" escolha "Personalizada" e digite a AÇÃO.',
        'A Amazon não permite criar rotinas automaticamente; crie só as que você usa muito.',
        '',
    ];
    const programs = list.programs.filter((program) => program.active && program.aliases.length > 0);
    for (const program of programs) {
        for (const alias of program.aliases) {
            lines.push(`FRASE: ${alias}`);
            lines.push(`AÇÃO:  pede para ${invocationName} ${alias}`);
            lines.push('');
        }
    }
    if (programs.length === 0) lines.push('(Nenhum programa com apelido ainda. Coloque apelidos em "Editar lista de programas".)');
    return `${lines.join('\r\n')}\r\n`;
}

/**
 * @param {object} deps
 * @param {{ PROGRAMS_FILE: string, PREFERENCES_FILE: string, ROUTINES_FILE: string }} deps.files
 * @param {string} deps.scanScript
 */
function createProgramsManager({ files, scanScript, execFile = childProcess.execFile }) {
    let cache;

    function runScan() {
        return new Promise((resolve, reject) => {
            execFile(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scanScript], {
                shell: false, windowsHide: true, timeout: SCAN_TIMEOUT_MS, maxBuffer: SCAN_MAX_OUTPUT_BYTES, encoding: 'utf8',
            }, (error, stdout) => {
                if (error) {
                    reject(new ProgramsManagerError('não foi possível detectar os programas'));
                    return;
                }
                try {
                    resolve(JSON.parse(String(stdout).replace(/^﻿/, '')));
                } catch (parseError) {
                    reject(new ProgramsManagerError('a detecção devolveu um resultado inválido'));
                }
            });
        });
    }

    return {
        /** Lista atual (relida só quando o arquivo muda: edições no Bloco de Notas valem na hora). */
        load() {
            let modified = 0;
            try {
                modified = fs.statSync(files.PROGRAMS_FILE).mtimeMs;
            } catch (error) {
                modified = -1;
            }
            if (!cache || cache.modified !== modified) cache = { modified, list: loadProgramList(files.PROGRAMS_FILE) };
            return cache.list;
        },

        /** Detecta de novo e mescla, mantendo apelidos, verbos e escolhas do dono. */
        async refresh() {
            const detected = await runScan();
            if (!Array.isArray(detected)) throw new ProgramsManagerError('a detecção devolveu um resultado inválido');
            const merged = mergeDetected(loadProgramList(files.PROGRAMS_FILE), detected);
            saveProgramList(files.PROGRAMS_FILE, merged);
            cache = undefined;
            return { total: merged.programs.length, active: merged.programs.filter((program) => program.active).length };
        },

        /** Garante que o arquivo exista antes de abrir no Bloco de Notas. */
        async ensureFile() {
            if (!fs.existsSync(files.PROGRAMS_FILE)) await this.refresh();
            return files.PROGRAMS_FILE;
        },

        invocationName() {
            const preferences = readJson(files.PREFERENCES_FILE) || {};
            return normalizeInvocationName(preferences.nomeDeChamada) || DEFAULT_INVOCATION_NAME;
        },

        /** @returns {string} o nome gravado (o deploy aplica na skill) */
        setInvocationName(value) {
            const name = normalizeInvocationName(value);
            if (!name) throw new ProgramsManagerError('nome inválido: use só letras, por exemplo "o monstro" ou "a morgana"');
            const preferences = readJson(files.PREFERENCES_FILE) || {};
            fs.mkdirSync(path.dirname(files.PREFERENCES_FILE), { recursive: true });
            fs.writeFileSync(files.PREFERENCES_FILE, `${JSON.stringify({ ...preferences, nomeDeChamada: name }, null, 2)}\n`);
            return name;
        },

        /** Pasta onde o Claude Code recebe as ordens por voz (escolhida na bandeja). */
        claudeFolder() {
            const folder = (readJson(files.PREFERENCES_FILE) || {}).pastaClaudeCode;
            return typeof folder === 'string' && path.win32.isAbsolute(folder) && fs.existsSync(folder) ? folder : undefined;
        },

        setClaudeFolder(folder) {
            const value = String(folder || '').trim();
            if (!path.win32.isAbsolute(value) || !fs.existsSync(value) || !fs.statSync(value).isDirectory()) {
                throw new ProgramsManagerError('pasta inválida');
            }
            const preferences = readJson(files.PREFERENCES_FILE) || {};
            fs.mkdirSync(path.dirname(files.PREFERENCES_FILE), { recursive: true });
            fs.writeFileSync(files.PREFERENCES_FILE, `${JSON.stringify({ ...preferences, pastaClaudeCode: value }, null, 2)}\n`);
            return value;
        },

        writeRoutineSuggestions() {
            fs.mkdirSync(path.dirname(files.ROUTINES_FILE), { recursive: true });
            fs.writeFileSync(files.ROUTINES_FILE, buildRoutineSuggestions(this.load(), this.invocationName()), 'utf8');
            return files.ROUTINES_FILE;
        },
    };
}

module.exports = {
    DEFAULT_INVOCATION_NAME,
    ProgramsManagerError,
    normalizeInvocationName,
    buildRoutineSuggestions,
    createProgramsManager,
};
