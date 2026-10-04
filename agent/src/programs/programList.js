'use strict';
/*
 * Lista PRIVADA de programas (%LOCALAPPDATA%\OMonstro\programas.json): fica só neste PC, nunca vai para o Git.
 * O dono edita no Bloco de Notas: liga/desliga programas, coloca apelidos, desliga verbos e ajusta processos.
 * "Atualizar lista de programas" detecta de novo e MANTÉM essas edições.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isValidProcessTarget } = require('../desktop/inputHelper');
const { normalizeText } = require('./textNormalization');

const FILE_VERSION = 1;
const MAX_NAME_LENGTH = 120;
const MAX_ALIAS_LENGTH = 80;
const MAX_ALIASES = 30;
const MAX_APP_ID_LENGTH = 512;
const CONTROL_OR_QUOTE = /[\u0000-\u001f\u007f"]/;
const VERB_PATTERN = /^[a-zà-ú ]{2,30}$/;

/** Verbos (os "sufixos" da frase) por ação. Todos ligados em todo programa, salvo os de "verbosDesligados". */
const DEFAULT_VERBS = Object.freeze({
    abrir: Object.freeze(['abrir', 'executar', 'iniciar', 'rodar', 'ligar']),
    fechar: Object.freeze(['fechar', 'encerrar', 'sair']),
    destravar: Object.freeze(['destravar', 'reabrir', 'reiniciar']),
});

/** Apelidos sugeridos na primeira detecção (o dono pode apagar ou trocar). Chave = nome normalizado. */
const SUGGESTED_ALIASES = Object.freeze({
    'visual studio code': ['vs code', 'vscode', 'code'],
    claude: ['cloud'],
    'microsoft edge': ['edge'],
    'google chrome': ['chrome'],
    whatsapp: ['zap', 'whats'],
    'server minecraft': ['server de minecraft', 'servidor de minecraft', 'server do minecraft'],
    'gerenciador de tarefas': ['task manager'],
    'explorador de arquivos': ['explorer', 'meus arquivos'],
});

/**
 * Processos que a detecção não acha sozinha. Claude: o Claude Code roda em %APPDATA%\Claude\claude-code\<versão>
 * (o Cowork é um SERVIÇO do Windows e precisa de administrador; não entra aqui).
 */
const KNOWN_EXTRA_PROCESSES = Object.freeze({
    'gerenciador de tarefas': [{ folder: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), exe: 'Taskmgr.exe' }],
    claude: [{ folder: path.join(process.env.APPDATA || 'C:\\Users\\Default\\AppData\\Roaming', 'Claude'), exe: 'claude.exe' }],
});

/** Entradas que quase ninguém quer abrir por voz começam desligadas (desinstaladores, manuais…). */
const INACTIVE_BY_DEFAULT = /\b(uninstall|desinstalar|remover|readme|leia me|help|ajuda|manual|documentation|documentacao|reference|localization|website|license|licenca|release notes|changelog|faq|support|suporte)\b/;

const README = Object.freeze([
    'Lista privada de programas do O Monstro. Fica só neste PC.',
    'ativo: true/false liga ou desliga o programa para a Alexa.',
    'apelidos: outros nomes que você fala (quantos quiser). Ex.: ["vs code", "editor"].',
    'verbosDesligados: verbos que NÃO valem para este programa. Ex.: ["ligar"]. Os verbos ficam em "verbos".',
    'processos: pasta + exe que "fechar" e "destravar" encerram. Programas com vários executáveis listam todos.',
    'Verbo novo em "verbos" só passa a ser entendido depois de "Publicar atualização" (deploy).',
    'Depois de editar, salve. Não precisa reiniciar nada.',
]);

class ProgramListError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProgramListError';
    }
}

/** Id estável: hash do nome detectado (não muda se o dono renomear). */
function programId(detectedName) {
    return `p${crypto.createHash('sha256').update(normalizeText(detectedName)).digest('hex').slice(0, 12)}`;
}

function isCleanString(value, maxLength) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !CONTROL_OR_QUOTE.test(value);
}

function uniqueProcesses(processes) {
    const seen = new Set();
    return processes.filter((target) => {
        const key = `${target.folder.toLowerCase()}|${target.exe.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Converte uma entrada do arquivo (chaves em português) no formato interno, ou undefined se inválida. */
function parseEntry(entry) {
    if (!entry || typeof entry !== 'object') return undefined;
    if (!isCleanString(entry.nome, MAX_NAME_LENGTH) || !isCleanString(entry.abrirCom, MAX_APP_ID_LENGTH)) return undefined;
    const aliases = Array.isArray(entry.apelidos) ? entry.apelidos.filter((alias) => isCleanString(alias, MAX_ALIAS_LENGTH)).slice(0, MAX_ALIASES) : [];
    const disabledVerbs = Array.isArray(entry.verbosDesligados) ? entry.verbosDesligados.filter((verb) => typeof verb === 'string' && VERB_PATTERN.test(verb)) : [];
    const processes = Array.isArray(entry.processos)
        ? entry.processos.map((target) => ({ folder: target && target.pasta, exe: target && target.exe })).filter(isValidProcessTarget)
        : [];
    return {
        id: typeof entry.id === 'string' && /^p[0-9a-f]{12}$/.test(entry.id) ? entry.id : programId(entry.nome),
        name: entry.nome.trim(),
        active: entry.ativo !== false,
        aliases,
        disabledVerbs,
        appId: entry.abrirCom,
        processes: uniqueProcesses(processes),
        manual: entry.manual === true,
    };
}

function toFileEntry(program) {
    return {
        nome: program.name,
        ativo: program.active,
        apelidos: program.aliases,
        verbosDesligados: program.disabledVerbs,
        abrirCom: program.appId,
        processos: program.processes.map((target) => ({ pasta: target.folder, exe: target.exe })),
        id: program.id,
        ...(program.manual ? { manual: true } : {}),
    };
}

function parseVerbs(verbs) {
    const result = {};
    for (const [action, defaults] of Object.entries(DEFAULT_VERBS)) {
        const custom = verbs && Array.isArray(verbs[action]) ? verbs[action].filter((verb) => typeof verb === 'string' && VERB_PATTERN.test(verb)) : [];
        result[action] = custom.length ? [...new Set(custom)] : [...defaults];
    }
    return result;
}

/** @returns {{ verbs: object, programs: object[], skipped: number }} */
function parseProgramList(source) {
    if (!source || typeof source !== 'object' || !Array.isArray(source.programas)) throw new ProgramListError('lista sem "programas"');
    const programs = [];
    let skipped = 0;
    for (const entry of source.programas) {
        const program = parseEntry(entry);
        if (program) programs.push(program); else skipped += 1;
    }
    return { verbs: parseVerbs(source.verbos), programs, skipped };
}

function serializeProgramList({ verbs, programs }) {
    const content = { versao: FILE_VERSION, leiaMe: README, verbos: verbs, programas: programs.map(toFileEntry) };
    return `${JSON.stringify(content, null, 2)}\n`;
}

function fromDetected(detected) {
    const key = normalizeText(detected.name);
    const scannedProcesses = (detected.exes || [])
        .map((exe) => ({ folder: detected.folder, exe }))
        .filter(isValidProcessTarget);
    return {
        id: programId(detected.name),
        name: detected.name,
        active: !INACTIVE_BY_DEFAULT.test(key),
        aliases: [...(SUGGESTED_ALIASES[key] || [])],
        disabledVerbs: [],
        appId: detected.appId,
        processes: uniqueProcesses([...scannedProcesses, ...(KNOWN_EXTRA_PROCESSES[key] || [])]),
        manual: false,
    };
}

/** O dono mexeu nesta entrada? (diferente do que a detecção teria criado) */
function isCustomized(program) {
    const key = normalizeText(program.name);
    const suggested = SUGGESTED_ALIASES[key] || [];
    return program.manual
        || program.disabledVerbs.length > 0
        || program.active === INACTIVE_BY_DEFAULT.test(key)
        || JSON.stringify(program.aliases) !== JSON.stringify(suggested);
}

/**
 * Junta a detecção nova com a lista atual. Mantém o que o dono editou (ativo, apelidos, verbos, processos extras)
 * e as entradas manuais; acrescenta os programas novos; remove os desinstalados que ele não personalizou.
 */
function mergeDetected(current, detectedList) {
    const currentById = new Map(current.programs.map((program) => [program.id, program]));
    const merged = [];
    const seen = new Set();
    for (const detected of detectedList) {
        if (!isCleanString(detected.name, MAX_NAME_LENGTH) || !isCleanString(detected.appId, MAX_APP_ID_LENGTH)) continue;
        const fresh = fromDetected(detected);
        if (seen.has(fresh.id)) continue;
        seen.add(fresh.id);
        const existing = currentById.get(fresh.id);
        merged.push(existing ? {
            ...existing,
            appId: fresh.appId,
            processes: uniqueProcesses([...existing.processes, ...fresh.processes]),
        } : fresh);
    }
    for (const program of current.programs) {
        if (!seen.has(program.id) && isCustomized(program)) merged.push(program);
    }
    merged.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    return { verbs: current.verbs, programs: merged };
}

function emptyProgramList() {
    return { verbs: parseVerbs(undefined), programs: [], skipped: 0 };
}

function loadProgramList(filePath) {
    if (!fs.existsSync(filePath)) return emptyProgramList();
    let source;
    try {
        source = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new ProgramListError('programas.json não é um JSON válido (confira vírgulas e aspas)');
    }
    return parseProgramList(source);
}

function saveProgramList(filePath, list) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, serializeProgramList(list), 'utf8');
    fs.renameSync(temporary, filePath);
}

module.exports = {
    DEFAULT_VERBS,
    ProgramListError,
    programId,
    parseProgramList,
    serializeProgramList,
    mergeDetected,
    emptyProgramList,
    loadProgramList,
    saveProgramList,
};
