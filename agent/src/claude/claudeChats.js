'use strict';
/*
 * Vínculo de chat do Claude Code por voz: a primeira ordem cria (ou retoma) um chat e as ordens seguintes vão
 * para o MESMO chat enquanto houver uso nas últimas 3 horas. Passado esse tempo, a próxima ordem pergunta se é
 * para continuar o chat anterior ou começar um novo. Arquivo privado: %LOCALAPPDATA%\OMonstro\claude-chats.json.
 */
const fs = require('fs');
const path = require('path');

const BINDING_WINDOW_MS = 3 * 60 * 60 * 1000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {{ filePath: string, clock?: () => number }} deps
 */
function createClaudeChats({ filePath, clock = Date.now }) {
    function read() {
        try {
            const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return { byFolder: state.byFolder && typeof state.byFolder === 'object' ? state.byFolder : {}, current: state.current };
        } catch (error) {
            return { byFolder: {}, current: undefined };
        }
    }

    function write(state) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
    }

    function isActive(binding) {
        return Boolean(binding) && clock() - (binding.lastUsed || 0) < BINDING_WINDOW_MS;
    }

    function bindingFor(state, folder) {
        const binding = state.byFolder[folder.toLowerCase()];
        return binding && SESSION_ID_PATTERN.test(binding.sessionId || '') ? binding : undefined;
    }

    return {
        isActive,

        /** Chat em uso agora (última ordem há menos de 3 h), em qualquer pasta. */
        activeCurrent() {
            const state = read();
            const binding = state.current ? bindingFor(state, state.current) : undefined;
            return isActive(binding) ? binding : undefined;
        },

        /** Último chat desta pasta (ativo ou não). */
        previousFor(folder) {
            return bindingFor(read(), folder);
        },

        /** A ordem foi enviada para este chat: renova as 3 horas e o torna o chat atual. */
        remember(folder, sessionId) {
            if (!SESSION_ID_PATTERN.test(sessionId || '')) return;
            const state = read();
            const key = folder.toLowerCase();
            state.byFolder[key] = { folder, sessionId, lastUsed: clock() };
            state.current = key;
            write(state);
        },

        /** "Encerrar sessão do Claude Code": solta o vínculo (a próxima ordem pergunta continuar/novo). */
        release() {
            const state = read();
            for (const binding of Object.values(state.byFolder)) binding.lastUsed = 0;
            write(state);
        },
    };
}

module.exports = { BINDING_WINDOW_MS, SESSION_ID_PATTERN, createClaudeChats };
