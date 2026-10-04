'use strict';
/*
 * Lista PRIVADA de pastas do Claude Code (%LOCALAPPDATA%\OMonstro\pastas-claude-code.json): importada do histórico
 * do Claude Code (~/.claude/projects/*\/*.jsonl guarda a pasta real em "cwd"), editável no Bloco de Notas.
 *
 * Por voz: "mandar o Claude Code no projeto comandos rodar os testes" → pasta "comandos-em-meu-computador",
 * ordem "rodar os testes". Sem "no projeto …", vale a pasta marcada como "padrao".
 */
const fs = require('fs');
const path = require('path');
const { scoreCandidate } = require('../programs/programMatcher');

const READ_BYTES = 256 * 1024;
const MAX_PROJECT_WORDS = 5;
const ACCEPT_SCORE = 70;
const AMBIGUITY_MARGIN = 8;
const MAX_CHOICES = 3;
const MAX_NAME_LENGTH = 120;
// "no projeto X …", "na pasta X …", "do projeto X …", "para o projeto X …"
const PROJECT_PREFIX = /^\s*(no|na|do|da|pro|pra|para o|para a)\s+(projeto|pasta)\s+(.+)$/i;
const SEPARATORS = /^[\s,:;.-]+|^(e|que)\s+/i;
// A própria pasta Temp e a raiz de um disco começam desligadas (raramente são projetos).
const INACTIVE_BY_DEFAULT = /\\AppData\\Local\\Temp\\?$|^[A-Za-z]:\\?$/i;

const FolderStatus = Object.freeze({ OK: 'ok', AMBIGUOUS: 'ambiguous', NOT_FOUND: 'not_found', NO_DEFAULT: 'no_default' });

const README = Object.freeze([
    'Pastas onde o Claude Code recebe ordens por voz. Fica só neste PC.',
    'ativo: true/false. apelidos: outros nomes que você fala ("comandos", "monstro").',
    'padrao: true na pasta usada quando você não diz "no projeto …" (só uma).',
    'Por voz: "pede para o monstro mandar o Claude Code no projeto <nome> <ordem>".',
]);

function isUsableFolder(folder) {
    try {
        fs.accessSync(folder, fs.constants.R_OK | fs.constants.W_OK);
        return fs.statSync(folder).isDirectory();
    } catch (error) {
        return false;
    }
}

/** Primeira "cwd" encontrada nas primeiras linhas de um histórico do Claude Code. */
function readCwd(transcriptFile) {
    let text;
    try {
        const handle = fs.openSync(transcriptFile, 'r');
        const buffer = Buffer.alloc(READ_BYTES);
        const length = fs.readSync(handle, buffer, 0, READ_BYTES, 0);
        fs.closeSync(handle);
        text = buffer.slice(0, length).toString('utf8');
    } catch (error) {
        return undefined;
    }
    for (const line of text.split('\n')) {
        try {
            const entry = JSON.parse(line);
            if (typeof entry.cwd === 'string' && path.win32.isAbsolute(entry.cwd)) return entry.cwd;
        } catch (error) {
            // linha cortada no fim do trecho lido
        }
    }
    return undefined;
}

/** @returns {{ folder: string, lastUsed: number }[]} pastas do histórico que existem e que podemos usar */
function scanClaudeProjects(projectsDir) {
    const found = new Map();
    let entries = [];
    try {
        entries = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch (error) {
        return [];
    }
    for (const entry of entries) {
        const directory = path.join(projectsDir, entry.name);
        const transcripts = fs.readdirSync(directory).filter((name) => name.endsWith('.jsonl'))
            .map((name) => ({ file: path.join(directory, name), modified: fs.statSync(path.join(directory, name)).mtimeMs }))
            .sort((left, right) => right.modified - left.modified);
        for (const transcript of transcripts) {
            const cwd = readCwd(transcript.file);
            if (!cwd) continue;
            const key = cwd.toLowerCase();
            if (isUsableFolder(cwd) && (!found.has(key) || found.get(key).lastUsed < transcript.modified)) {
                found.set(key, { folder: cwd, lastUsed: transcript.modified });
            }
            break;
        }
    }
    return [...found.values()].sort((left, right) => right.lastUsed - left.lastUsed);
}

function folderName(folder) {
    return path.win32.basename(folder.replace(/\\+$/, '')) || folder;
}

function parseEntry(entry) {
    if (!entry || typeof entry.caminho !== 'string' || !path.win32.isAbsolute(entry.caminho)) return undefined;
    const name = typeof entry.nome === 'string' && entry.nome.trim() ? entry.nome.trim().slice(0, MAX_NAME_LENGTH) : folderName(entry.caminho);
    const aliases = Array.isArray(entry.apelidos) ? entry.apelidos.filter((alias) => typeof alias === 'string' && alias.trim()).map((alias) => alias.trim()) : [];
    return { name, aliases, folder: entry.caminho, active: entry.ativo !== false, isDefault: entry.padrao === true };
}

function toFileEntry(folder) {
    return { nome: folder.name, apelidos: folder.aliases, caminho: folder.folder, ativo: folder.active, padrao: folder.isDefault };
}

/**
 * @param {{ listFile: string, projectsDir: string, legacyDefault?: () => string|undefined }} deps
 */
function createClaudeFolders({ listFile, projectsDir, legacyDefault = () => undefined }) {
    function load() {
        try {
            const source = JSON.parse(fs.readFileSync(listFile, 'utf8').replace(/^﻿/, ''));
            return (Array.isArray(source.pastas) ? source.pastas : []).map(parseEntry).filter(Boolean);
        } catch (error) {
            return [];
        }
    }

    function save(folders) {
        // Só uma padrão: a primeira marcada.
        let defaultTaken = false;
        const normalized = folders.map((folder) => {
            const isDefault = folder.isDefault && !defaultTaken;
            if (isDefault) defaultTaken = true;
            return { ...folder, isDefault };
        });
        fs.mkdirSync(path.dirname(listFile), { recursive: true });
        fs.writeFileSync(listFile, `${JSON.stringify({ leiaMe: README, pastas: normalized.map(toFileEntry) }, null, 2)}\n`);
        return normalized;
    }

    function withDefault(folders) {
        if (folders.some((folder) => folder.isDefault)) return folders;
        const legacy = legacyDefault();
        const legacyIndex = legacy ? folders.findIndex((folder) => folder.folder.toLowerCase() === legacy.toLowerCase()) : -1;
        const index = legacyIndex >= 0 ? legacyIndex : folders.findIndex((folder) => folder.active);
        return folders.map((folder, position) => ({ ...folder, isDefault: position === index }));
    }

    function add(folders, folder, extra = {}) {
        if (folders.some((existing) => existing.folder.toLowerCase() === folder.toLowerCase())) return folders;
        return [...folders, { name: folderName(folder), aliases: [], folder, active: !INACTIVE_BY_DEFAULT.test(folder), isDefault: false, ...extra }];
    }

    function activeFolders() {
        return load().filter((folder) => folder.active && isUsableFolder(folder.folder));
    }

    /** Separa "no projeto <nome> <ordem>" testando de 1 a 5 palavras como nome. */
    function splitProject(rest, folders) {
        const words = rest.trim().split(/\s+/);
        const ranked = [];
        for (let size = 1; size <= Math.min(MAX_PROJECT_WORDS, words.length - 1); size += 1) {
            const spoken = words.slice(0, size).join(' ');
            for (const folder of folders) {
                const score = Math.max(...[folder.name, ...folder.aliases].map((name) => scoreCandidate(spoken, name)));
                ranked.push({ folder, score, order: words.slice(size).join(' ').replace(SEPARATORS, '').trim() });
            }
        }
        ranked.sort((left, right) => right.score - left.score);
        return ranked;
    }

    return {
        /** Importa do histórico do Claude Code, mantendo apelidos e escolhas já feitas. */
        importFromClaudeCode() {
            let folders = load();
            const legacy = legacyDefault();
            if (legacy && isUsableFolder(legacy)) folders = add(folders, legacy);
            for (const { folder } of scanClaudeProjects(projectsDir)) folders = add(folders, folder);
            const saved = save(withDefault(folders));
            return { total: saved.length, active: saved.filter((folder) => folder.active).length };
        },

        /** "Adicionar pasta…" da bandeja: entra na lista e vira a padrão. */
        addFolder(folder) {
            const value = String(folder || '').trim();
            if (!path.win32.isAbsolute(value) || !isUsableFolder(value)) throw new Error('pasta inválida');
            const folders = add(load().map((existing) => ({ ...existing, isDefault: false })), value)
                .map((existing) => (existing.folder.toLowerCase() === value.toLowerCase() ? { ...existing, active: true, isDefault: true } : existing));
            save(folders);
            return value;
        },

        ensureFile() {
            if (!fs.existsSync(listFile)) this.importFromClaudeCode();
            return listFile;
        },

        /**
         * @param {string} order       a ordem falada (pode começar com "no projeto <nome>")
         * @param {string} [chosen]    nome exato escolhido no "qual deles?"
         * @returns {{ status: string, folder?: string, order?: string, choices?: string[] }}
         */
        resolve(order, chosen) {
            const folders = activeFolders();
            const match = PROJECT_PREFIX.exec(order);
            if (!match) {
                const fallback = folders.find((folder) => folder.isDefault);
                return fallback ? { status: FolderStatus.OK, folder: fallback.folder, order: order.trim() } : { status: FolderStatus.NO_DEFAULT };
            }
            const candidates = chosen ? folders.filter((folder) => folder.name === chosen) : folders;
            const ranked = splitProject(match[3], candidates);
            const [best] = ranked;
            if (!best || best.score < ACCEPT_SCORE || !best.order) {
                const similar = [...new Set(ranked.filter((entry) => entry.score >= ACCEPT_SCORE / 2).map((entry) => entry.folder.name))];
                return { status: FolderStatus.NOT_FOUND, choices: similar.slice(0, MAX_CHOICES) };
            }
            const contenders = [...new Set(ranked.filter((entry) => best.score - entry.score < AMBIGUITY_MARGIN && entry.score >= ACCEPT_SCORE)
                .map((entry) => entry.folder.name))];
            if (contenders.length > 1 && best.score < 100) return { status: FolderStatus.AMBIGUOUS, choices: contenders.slice(0, MAX_CHOICES) };
            return { status: FolderStatus.OK, folder: best.folder.folder, order: best.order };
        },
    };
}

module.exports = { FolderStatus, scanClaudeProjects, readCwd, createClaudeFolders };
