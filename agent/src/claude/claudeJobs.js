'use strict';
/*
 * Perguntas ao Claude e ordens ao Claude Code rodam em SEGUNDO PLANO (o Claude leva de segundos a minutos;
 * a Alexa só espera ~8 s). Ao terminar: guarda a última resposta (arquivo privado), fala o resumo no PC e
 * mostra um balão. "A resposta do Claude" pela Alexa lê esse resumo.
 */
const fs = require('fs');
const path = require('path');
const { QUESTION_ARGS, NEW_ORDER_ARGS, resumeOrderArgs, ClaudeCliError, splitSummary } = require('./claudeCli');

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000;
const ORDER_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SUMMARY_LENGTH = 400;
const NOTICE_PREVIEW_LENGTH = 180;
// "novo chat, crie um README" → abre conversa nova; o resto da frase é a ordem.
const NEW_CHAT_PREFIX = /^\s*(em um |num |no )?(novo chat|chat novo|nova conversa|conversa nova)\s*[,:.-]?\s*/i;
const NOT_LOGGED_IN = /not logged in|please run \/login/i;
const NO_CONVERSATION = /no conversation found|no previous conversation/i;

const JobState = Object.freeze({ NONE: 'none', RUNNING: 'running', DONE: 'done' });

const FAILURE_SUMMARIES = Object.freeze({
    not_logged_in: 'O Claude Code do computador está sem login. Abra um terminal, rode claude e use /login.',
    claude_not_installed: 'Não achei o Claude Code instalado neste computador.',
    no_project_folder: 'Escolha a pasta do Claude Code no ícone do O Monstro, perto do relógio.',
    claude_timeout: 'O Claude demorou demais e eu parei de esperar.',
});
const GENERIC_FAILURE = 'O Claude não conseguiu responder desta vez.';

/**
 * @param {object} deps
 * @param {{ run: Function }} deps.cli
 * @param {{ answerFile: string, answerTextFile: string, questionsDir: string }} deps.files
 * @param {() => string|undefined} [deps.getPreferredExe]
 * @param {(text: string) => void} deps.speak
 * @param {(text: string) => void} deps.notify
 * @param {object} deps.logger
 */
function createClaudeJobs({ cli, files, getPreferredExe = () => undefined, speak, notify, logger, clock = Date.now }) {
    let running = 0;
    let latestJob = 0;

    function saveAnswer(answer) {
        fs.mkdirSync(path.dirname(files.answerFile), { recursive: true });
        fs.writeFileSync(files.answerFile, `${JSON.stringify(answer, null, 2)}\n`);
        fs.writeFileSync(files.answerTextFile, `${answer.full || answer.summary}\r\n`, 'utf8');
    }

    function finish(jobId, kind, outcome) {
        if (jobId !== latestJob) return; // uma pergunta mais nova já substituiu esta
        saveAnswer({ kind, at: clock(), ...outcome });
        notify(`Claude: ${outcome.summary.slice(0, NOTICE_PREVIEW_LENGTH)}`);
        speak(outcome.summary);
    }

    function failureOutcome(code) {
        const summary = FAILURE_SUMMARIES[code] || GENERIC_FAILURE;
        return { summary, full: summary, error: code };
    }

    async function runJob(kind, request) {
        latestJob += 1;
        const jobId = latestJob;
        running += 1;
        try {
            let reply = await cli.run({ ...request, preferredExe: getPreferredExe() });
            if (request.retryAsNew && reply.isError && NO_CONVERSATION.test(reply.result)) {
                // O chat vinculado sumiu (apagado/limpo): abre um novo e o vínculo passa a ser ele.
                reply = await cli.run({ ...request, args: NEW_ORDER_ARGS, preferredExe: getPreferredExe() });
            }
            if (reply.sessionId && request.onSession) request.onSession(reply.sessionId);
            if (reply.isError) {
                const code = NOT_LOGGED_IN.test(reply.result) ? 'not_logged_in' : 'claude_error';
                logger.warn({ event: 'claude_failed', kind, code });
                finish(jobId, kind, failureOutcome(code));
                return;
            }
            logger.info({ event: 'claude_answered', kind }); // nunca a pergunta nem a resposta
            finish(jobId, kind, splitSummary(reply.result, MAX_SUMMARY_LENGTH));
        } catch (error) {
            logger.warn({ event: 'claude_failed', kind, code: error.code || error.name });
            finish(jobId, kind, failureOutcome(error.code));
        } finally {
            running -= 1;
        }
    }

    return {
        /** Começa a pergunta e volta na hora (a Alexa responde "Perguntei ao Claude"). */
        ask(question) {
            fs.mkdirSync(files.questionsDir, { recursive: true });
            runJob('pergunta', { args: QUESTION_ARGS, prompt: question, cwd: files.questionsDir, timeoutMs: QUESTION_TIMEOUT_MS });
        },

        /**
         * Ordem ao Claude Code na pasta dada: no chat vinculado (sessionId) ou num chat novo.
         * @param {{ sessionId?: string, onSession?: (id: string) => void }} [chat]  onSession recebe o id do chat usado
         */
        order(text, folder, { sessionId, onSession } = {}) {
            if (!folder || !fs.existsSync(folder)) throw new ClaudeCliError('no_project_folder');
            const prompt = text.replace(NEW_CHAT_PREFIX, '');
            if (!prompt.trim()) throw new ClaudeCliError('empty_order');
            runJob('ordem', {
                args: sessionId ? resumeOrderArgs(sessionId) : NEW_ORDER_ARGS, prompt, cwd: folder, timeoutMs: ORDER_TIMEOUT_MS,
                retryAsNew: Boolean(sessionId), onSession,
            });
        },

        isNewChatRequest: (text) => NEW_CHAT_PREFIX.test(text),

        /** @returns {{ state: string, summary?: string }} */
        lastAnswer() {
            if (running > 0) return { state: JobState.RUNNING };
            try {
                const saved = JSON.parse(fs.readFileSync(files.answerFile, 'utf8'));
                return saved.summary ? { state: JobState.DONE, summary: saved.summary } : { state: JobState.NONE };
            } catch (error) {
                return { state: JobState.NONE };
            }
        },
    };
}

module.exports = { JobState, NEW_CHAT_PREFIX, createClaudeJobs };
