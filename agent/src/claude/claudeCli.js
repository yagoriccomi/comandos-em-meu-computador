'use strict';
/*
 * Roda o Claude Code do PC em modo não interativo (`claude -p`), com a ASSINATURA do dono (login feito uma vez
 * com `claude` → /login). O texto falado vai SEMPRE pelo stdin; os argumentos são fixos deste arquivo.
 */
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
// U+2028/U+2029 montados por código: escritos literalmente, eles quebram a linha do arquivo.
const CONTROL_CHARACTERS = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${String.fromCharCode(0x2028, 0x2029)}]+`, 'g');
const VERSION_DIR = /^\d+\.\d+\.\d+$/;
// Variáveis que fariam o CLI falar com outro processo (ex.: quando o agente é aberto de dentro do app Claude).
const INHERITED_CLAUDE_VARIABLES = /^(CLAUDE|ANTHROPIC)/i;

/** Pergunta: só pesquisa na web, sem tocar em arquivos nem rodar comandos. */
const QUESTION_ARGS = Object.freeze(['-p', '--model', 'sonnet', '--effort', 'medium', '--tools', 'WebSearch,WebFetch', '--permission-mode', 'dontAsk', '--output-format', 'json']);
/** Ordem em chat NOVO: Opus mais atual (alias "opus"), esforço médio, modo automático. */
const NEW_ORDER_ARGS = Object.freeze(['-p', '--model', 'opus', '--effort', 'medium', '--permission-mode', 'auto', '--output-format', 'json']);
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ordem num chat JÁ vinculado: mantém o modelo do chat e só repassa o texto. O id vem do próprio CLI. */
function resumeOrderArgs(sessionId) {
    if (!SESSION_ID_PATTERN.test(sessionId || '')) throw new ClaudeCliError('invalid_session_id');
    return ['-p', '--resume', sessionId, '--permission-mode', 'auto', '--output-format', 'json'];
}

const VOICE_SYSTEM_PROMPT = [
    'Este pedido chegou por voz, pela Alexa, e a resposta será lida em voz alta.',
    'Responda em português do Brasil, sem markdown, sem tabelas e sem listas longas.',
    'Termine SEMPRE com uma última linha exatamente neste formato: RESUMO: <até 3 frases curtas, no máximo 400 caracteres>.',
].join(' ');

class ClaudeCliError extends Error {
    constructor(code) {
        super(code);
        this.name = 'ClaudeCliError';
        this.code = code;
    }
}

function newestVersionedExe(root) {
    try {
        const versions = fs.readdirSync(root).filter((name) => VERSION_DIR.test(name))
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
        for (const version of versions.reverse()) {
            for (const build of fs.readdirSync(path.join(root, version))) {
                const candidate = path.join(root, version, build, 'claude.exe');
                if (fs.existsSync(candidate)) return candidate;
            }
        }
    } catch (error) {
        return undefined;
    }
    return undefined;
}

/** Ordem: preferência do dono → npm global → instalador nativo → cópia que vem com o app Claude. */
function findClaudeExecutable({ preferred, env = process.env, exists = fs.existsSync } = {}) {
    const candidates = [
        preferred,
        env.APPDATA && path.join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
        env.USERPROFILE && path.join(env.USERPROFILE, '.local', 'bin', 'claude.exe'),
    ].filter(Boolean);
    const found = candidates.find((candidate) => path.win32.isAbsolute(candidate) && /\.exe$/i.test(candidate) && exists(candidate));
    if (found) return found;
    return env.APPDATA ? newestVersionedExe(path.join(env.APPDATA, 'Claude', 'claude-code')) : undefined;
}

function cleanEnvironment(env) {
    return Object.fromEntries(Object.entries(env).filter(([name]) => !INHERITED_CLAUDE_VARIABLES.test(name)));
}

/** Separa a resposta completa do "RESUMO:" final (o que a Alexa e a voz do PC leem). */
function splitSummary(text, maxSummaryLength) {
    const answer = String(text || '').trim();
    const marker = answer.lastIndexOf('RESUMO:');
    const full = (marker >= 0 ? answer.slice(0, marker) : answer).trim() || answer;
    const summarySource = marker >= 0 ? answer.slice(marker + 'RESUMO:'.length) : answer;
    const summary = summarySource.replace(CONTROL_CHARACTERS, ' ').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
    return { full, summary: summary.length > maxSummaryLength ? `${summary.slice(0, maxSummaryLength - 1).trim()}…` : summary };
}

/**
 * @param {{ spawn?: Function, findExecutable?: Function }} [deps]
 */
function createClaudeCli({ spawn = childProcess.spawn, findExecutable = findClaudeExecutable } = {}) {
    /**
     * @param {{ args: string[], prompt: string, cwd: string, timeoutMs: number, preferredExe?: string }} request
     * @returns {Promise<{ result: string, isError: boolean, sessionId?: string }>}
     */
    function run({ args, prompt, cwd, timeoutMs, preferredExe }) {
        const executable = findExecutable({ preferred: preferredExe });
        if (!executable) return Promise.reject(new ClaudeCliError('claude_not_installed'));
        return new Promise((resolve, reject) => {
            const child = spawn(executable, [...args, '--append-system-prompt', VOICE_SYSTEM_PROMPT], {
                shell: false, windowsHide: true, cwd, env: cleanEnvironment(process.env), stdio: ['pipe', 'pipe', 'pipe'],
            });
            let output = '';
            const timer = setTimeout(() => {
                child.kill();
                reject(new ClaudeCliError('claude_timeout'));
            }, timeoutMs);
            child.stdout.on('data', (chunk) => {
                if (output.length < MAX_OUTPUT_BYTES) output += chunk;
            });
            child.stderr.on('data', () => {});
            child.on('error', (error) => {
                clearTimeout(timer);
                reject(new ClaudeCliError(error.code || 'claude_spawn_failed'));
            });
            child.on('close', () => {
                clearTimeout(timer);
                try {
                    const parsed = JSON.parse(output);
                    const sessionId = SESSION_ID_PATTERN.test(parsed.session_id || '') ? parsed.session_id : undefined;
                    resolve({ result: String(parsed.result || ''), isError: parsed.is_error === true, sessionId });
                } catch (error) {
                    reject(new ClaudeCliError('claude_bad_output'));
                }
            });
            child.stdin.end(prompt, 'utf8');
        });
    }
    return { run };
}

module.exports = {
    QUESTION_ARGS,
    NEW_ORDER_ARGS,
    resumeOrderArgs,
    ClaudeCliError,
    findClaudeExecutable,
    cleanEnvironment,
    splitSummary,
    createClaudeCli,
};
