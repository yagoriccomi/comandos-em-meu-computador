'use strict';
/*
 * Ações internas: código FIXO do agente, rodando na sessão do usuário. Nada vindo da Alexa vira comando:
 * - mídia/teclado: verbos fechados do input-helper, com números já validados;
 * - pesquisa: só a URL do Google com o texto codificado;
 * - programas: o nome falado só é COMPARADO com a lista privada; o que roda é o que está na lista.
 */
const { HelperVerb } = require('../desktop/inputHelper');
const { matchProgram, MatchStatus } = require('../programs/programMatcher');
const { protocol } = require('../shared');
const { LockStatus } = require('../claude/sessionLock');
const { JobState } = require('../claude/claudeJobs');
const { FolderStatus, namesProject } = require('../claude/claudeFolders');

const CHAT_CHOICES = Object.freeze({ CONTINUE: 'continuar', NEW: 'novo' });

const LOCK_RESULTS = Object.freeze({
    [LockStatus.PIN_REQUIRED]: { ok: false, status: protocol.AckStatus.PIN_REQUIRED },
    [LockStatus.LOCKED]: { ok: false, status: protocol.AckStatus.LOCKED },
});

const GOOGLE_SEARCH_URL = 'https://www.google.com/search?q=';
const WINDOWS_VOLUME_STEP_PERCENT = 2; // cada toque da tecla de volume muda 2%
const CLOSE_GRACE_MS = 5000;

/** encodeURIComponent deixa !'()* passarem; aqui tudo que não é letra/dígito vira %XX. */
function encodeQuery(text) {
    return encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function searchUrl(query) {
    return `${GOOGLE_SEARCH_URL}${encodeQuery(query)}`;
}

function volumePresses(percent) {
    return Math.max(1, Math.round(percent / WINDOWS_VOLUME_STEP_PERCENT));
}

/** Opções que vão para a Alexa falar: só nomes curtos e limpos (o protocolo recusaria o resto). */
function speakableChoices(names) {
    return names
        .map((name) => String(name).slice(0, protocol.MAX_CHOICE_LENGTH).trim())
        .filter((name) => protocol.isValidTextParam(name))
        .slice(0, protocol.MAX_ACK_CHOICES);
}

function isHelperOk(reply) {
    return typeof reply === 'string' && reply.startsWith('ok');
}

/**
 * @param {object} deps
 * @param {{ run: (verb: string, argument?: any) => Promise<string> }} deps.inputHelper
 * @param {() => { programs: object[] }} deps.loadPrograms   lê a lista privada (a cada pedido: edições valem na hora)
 * @param {{ openApp: (appId: string) => Promise<boolean>, openUrl: (url: string) => Promise<boolean> }} deps.launcher
 * @param {object} deps.logger
 * @param {{ ask: Function, order: Function, lastAnswer: Function }} [deps.claudeJobs]
 * @param {{ check: Function, revoke: Function }} [deps.sessionLock]
 * @param {{ resolve: Function }} [deps.claudeFolders]   lista privada de pastas do Claude Code
 * @param {{ activeCurrent: Function, previousFor: Function, isActive: Function, remember: Function, release: Function }} [deps.claudeChats]
 * @param {(text: string) => void} [deps.notify]   balão perto do relógio
 */
function createInternalRunner({
    inputHelper, loadPrograms, launcher, logger, claudeJobs, sessionLock, claudeFolders, claudeChats, notify = () => {},
    setTimer = setTimeout, closeGraceMs = CLOSE_GRACE_MS,
}) {
    async function helper(verb, argument) {
        const reply = await inputHelper.run(verb, argument);
        if (!isHelperOk(reply)) logger.warn({ event: 'input_helper_reply', verb, reply: reply.slice(0, 40) });
        return { ok: isHelperOk(reply) };
    }

    function findProgram(params) {
        const { programs } = loadPrograms();
        const match = matchProgram(params.programa, programs, { verb: params.verbo, exact: params.exato === 1 });
        if (match.status === MatchStatus.OK) return { program: match.program };
        // Nome falado e opções NÃO vão para o log (só o código do resultado).
        logger.info({ event: 'program_lookup', status: match.status, choices: match.choices.length });
        return { result: { ok: false, status: match.status, choices: speakableChoices(match.choices) } };
    }

    async function openProgram(params) {
        const { program, result } = findProgram(params);
        if (!program) return result;
        return { ok: await launcher.openApp(program.appId) };
    }

    async function closeProgram(params) {
        const { program, result } = findProgram(params);
        if (!program) return result;
        if (program.processes.length === 0) {
            logger.warn({ event: 'program_without_processes' });
            return { ok: false };
        }
        const replies = await Promise.all(program.processes.map((target) => inputHelper.run(HelperVerb.CLOSE, target)));
        // Quem se esconde na bandeja (sem janela) é encerrado depois de alguns segundos; janela aberta fica (pode ter algo por salvar).
        setTimer(() => {
            for (const target of program.processes) inputHelper.run(HelperVerb.FORCE_WINDOWLESS, target).catch(() => {});
        }, closeGraceMs);
        return { ok: replies.some(isHelperOk) || replies.every((reply) => reply === 'erro not_running') };
    }

    async function unlockProgram(params) {
        const { program, result } = findProgram(params);
        if (!program) return result;
        for (const target of program.processes) {
            const reply = await inputHelper.run(HelperVerb.KILL, target);
            if (!isHelperOk(reply)) logger.warn({ event: 'program_kill_failed', reply: reply.slice(0, 40) });
        }
        return { ok: await launcher.openApp(program.appId) };
    }

    function askClaude(params) {
        claudeJobs.ask(params.pergunta);
        return { ok: true };
    }

    /** Resumo da última resposta para a Alexa ler (só o resumo; a resposta inteira fica no PC). */
    function readClaudeAnswer() {
        const answer = claudeJobs.lastAnswer();
        if (answer.state === JobState.RUNNING) return { ok: false, status: protocol.AckStatus.PENDING };
        if (answer.state !== JobState.DONE) return { ok: false, status: protocol.AckStatus.NOT_FOUND };
        const text = answer.summary.slice(0, protocol.MAX_ACK_TEXT_LENGTH).trim();
        return text ? { ok: true, text } : { ok: false, status: protocol.AckStatus.NOT_FOUND };
    }

    /** Ordem ao Claude Code: só com a sessão ativa (PIN nas últimas 3 h) e não revogada. */
    function orderClaudeCode(params) {
        const status = sessionLock.check(params.pin);
        if (status === LockStatus.NO_PIN) {
            notify('Defina o PIN do Claude Code no ícone do O Monstro (menu Claude Code).');
            return { ok: false };
        }
        if (status !== LockStatus.OK) return LOCK_RESULTS[status];
        // A pasta só é procurada DEPOIS do PIN: sem sessão ativa, nem os nomes dos projetos saem do PC.
        // Sem "no projeto …", a ordem vai para o chat vinculado (usado nas últimas 3 h), se houver.
        const current = !namesProject(params.ordem) && !params.projeto ? claudeChats.activeCurrent() : undefined;
        const target = current ? { status: FolderStatus.OK, folder: current.folder, order: params.ordem } : claudeFolders.resolve(params.ordem, params.projeto);
        if (target.status === FolderStatus.NO_DEFAULT) {
            notify('Marque uma pasta padrão do Claude Code (ícone do O Monstro → Claude Code → Editar lista de pastas).');
            return { ok: false };
        }
        if (target.status !== FolderStatus.OK) {
            return { ok: false, status: target.status, choices: speakableChoices(target.choices || []) };
        }
        const previous = claudeChats.previousFor(target.folder);
        let sessionId;
        if (!claudeJobs.isNewChatRequest(target.order) && previous) {
            if (claudeChats.isActive(previous) || params.chat === CHAT_CHOICES.CONTINUE) sessionId = previous.sessionId;
            else if (params.chat !== CHAT_CHOICES.NEW) return { ok: false, status: protocol.AckStatus.CHAT_CHOICE };
        }
        try {
            // Renova as 3 h já no envio; o id definitivo (chat novo) chega quando o Claude responde.
            if (sessionId) claudeChats.remember(target.folder, sessionId);
            claudeJobs.order(target.order, target.folder, { sessionId, onSession: (id) => claudeChats.remember(target.folder, id) });
        } catch (error) {
            logger.warn({ event: 'claude_order_refused', code: error.code });
            if (error.code === 'no_project_folder') notify('A pasta do Claude Code não existe mais. Atualize a lista no ícone do O Monstro.');
            return { ok: false };
        }
        return { ok: true };
    }

    function endClaudeCodeSession() {
        sessionLock.revoke();
        claudeChats.release();
        notify('Sessão do Claude Code encerrada. A próxima ordem vai pedir o PIN.');
        return { ok: true };
    }

    const handlers = {
        pausar_continuar: () => helper(HelperVerb.PLAY_PAUSE),
        alternar_mudo: () => helper(HelperVerb.MUTE),
        tela_cheia: () => helper(HelperVerb.FULLSCREEN),
        sair_tela_cheia: () => helper(HelperVerb.EXIT_FULLSCREEN),
        pular: () => helper(HelperVerb.SKIP),
        aumentar_volume: (params) => helper(HelperVerb.VOLUME_UP, volumePresses(params.quantidade)),
        abaixar_volume: (params) => helper(HelperVerb.VOLUME_DOWN, volumePresses(params.quantidade)),
        avancar_tempo: (params) => helper(HelperVerb.SEEK, params.segundos),
        voltar_tempo: (params) => helper(HelperVerb.SEEK, -params.segundos),
        pesquisar_google: async (params) => ({ ok: await launcher.openUrl(searchUrl(params.consulta)) }),
        abrir_programa: openProgram,
        fechar_programa: closeProgram,
        destravar_programa: unlockProgram,
        perguntar_claude: askClaude,
        resposta_claude: readClaudeAnswer,
        claude_code_ordem: orderClaudeCode,
        claude_code_encerrar: endClaudeCodeSession,
    };

    return {
        /** @returns {Promise<{ ok: boolean, status?: string, choices?: string[] }>} */
        async run(actionId, params) {
            const handler = handlers[actionId];
            if (!handler) return { ok: false };
            return handler(params);
        },
        actionIds: Object.keys(handlers),
    };
}

module.exports = { createInternalRunner, searchUrl, volumePresses, speakableChoices };
