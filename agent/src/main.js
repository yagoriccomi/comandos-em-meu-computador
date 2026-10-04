'use strict';
/*
 * node.exe o-monstro.cjs   (instalado em C:\Program Files\OMonstro, com o Node.js oficial assinado)
 *   (sem argumentos) | --instalar   assistente de instalação
 *   --nucleo                        núcleo (tarefa agendada na inicialização do Windows)
 *   --desktop                       ícone na bandeja + ações de tela (tarefa agendada no logon)
 *   --desinstalar                   remove o agente
 *   --versao
 */
const path = require('path');
const paths = require('./config/paths');
const { publicCatalog } = require('./shared');
const { loadAgentConfig } = require('./config/agentConfig');
const { loadLocalActions } = require('./config/localActions');
const { createLocalLogger } = require('./logger/localLogger');
const { createActionExecutor } = require('./executor/actionExecutor');
const { createCommandGuard } = require('./security/commandGuard');
const { createPersistentMqttTransport, BrokerStatus } = require('./transport/mqttTransport');
const { createPauseState } = require('./core/pauseState');
const { createDesktopBridge } = require('./core/desktopBridge');
const { createAgentCore } = require('./core/agentCore');
const { createDesktopSession, createStatusFileWriter } = require('./desktop/desktopSession');
const fs = require('fs');
const childProcess = require('child_process');
const { startTray, TrayCommand, POWERSHELL_EXE, NOTEPAD_EXE } = require('./desktop/trayController');
const { createInputHelper } = require('./desktop/inputHelper');
const { createInternalRunner } = require('./internal/internalActions');
const { createLauncher } = require('./internal/launcher');
const { createProgramsManager } = require('./programs/programsManager');
const { createClaudeCli } = require('./claude/claudeCli');
const { createClaudeJobs } = require('./claude/claudeJobs');
const { createSessionLock } = require('./claude/sessionLock');
const { isPackagedInstall, DEV_ASSET_PATHS, assetPath } = require('./assets');

const VERSION = '2.0.0';
const EXIT_FAILURE = 1;

function installGlobalErrorHandlers(logger) {
    process.on('unhandledRejection', (reason) => {
        logger.error({ event: 'unhandled_rejection', errorName: reason && reason.name });
    });
    process.on('uncaughtException', (error) => {
        // Estado desconhecido: registra e sai com falha; a tarefa agendada reinicia em 1 minuto.
        logger.error({ event: 'uncaught_exception', errorName: error.name, errorCode: error.code });
        process.exit(EXIT_FAILURE);
    });
}

function loadRuntimeConfig(logger) {
    try {
        return {
            config: loadAgentConfig(paths.CONFIG_FILE),
            localActions: loadLocalActions(paths.ACTIONS_FILE, publicCatalog),
        };
    } catch (error) {
        logger.error({ event: 'config_invalid', errorName: error.name, detail: error.code || error.message });
        process.exit(EXIT_FAILURE);
        return undefined;
    }
}

async function runCore() {
    const logger = createLocalLogger({ directory: paths.LOG_DIR, fileName: 'agent.log', component: 'core' });
    installGlobalErrorHandlers(logger);
    const { config, localActions } = loadRuntimeConfig(logger);
    const pauseState = createPauseState(paths.STATE_FILE);
    let brokerStatus = BrokerStatus.CONNECTING;
    let transport;

    const bridge = createDesktopBridge({
        endpointFile: paths.CORE_ENDPOINT_FILE,
        pipeSecret: config.pipeSecret,
        logger,
        getStatus: () => ({ broker: brokerStatus, paused: pauseState.isPaused() }),
        onPauseChange: (paused) => {
            pauseState.setPaused(paused);
            logger.info({ event: paused ? 'paused_by_user' : 'resumed_by_user' });
        },
        onShutdownRequested: async () => {
            await Promise.allSettled([transport.close(), bridge.close()]);
            process.exit(0); // saída normal: o Agendador não reinicia até o próximo boot
        },
    });
    await bridge.listen();

    transport = createPersistentMqttTransport({
        ...config.mqtt,
        clientId: config.deviceId,
        logger,
        onStatus: (status) => {
            brokerStatus = status;
            bridge.publishStatus();
        },
    });

    const core = createAgentCore({
        config,
        transport,
        guard: createCommandGuard({ secret: config.hmacSecret }),
        localActions,
        executor: createActionExecutor({ logger }),
        desktopBridge: bridge,
        pauseState,
        logger,
    });
    await core.start();
}

/** Abre um arquivo no Bloco de Notas (lista de programas, rotinas sugeridas). */
function openInNotepad(filePath) {
    childProcess.execFile(NOTEPAD_EXE, [filePath], { shell: false }, () => {});
}

/** "Publicar atualização": janela visível rodando o script de deploy do repositório. */
function startDeploy(statusWriter, state) {
    if (!fs.existsSync(paths.DEPLOY_SCRIPT)) {
        statusWriter.notify('Não achei o script de deploy. Gere o pacote de novo a partir do repositório.', state());
        return;
    }
    const child = childProcess.spawn(POWERSHELL_EXE, ['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', paths.DEPLOY_SCRIPT], {
        shell: false, detached: true, stdio: 'ignore', windowsHide: false, cwd: paths.REPO_DIR,
    });
    child.unref();
}

/** Voz do Windows: o texto vai pelo STDIN do speak.ps1 (nunca como argumento). */
function createSpeaker(logger) {
    const script = assetPath('speak.ps1', paths.SPEAK_SCRIPT);
    return (text) => {
        const child = childProcess.spawn(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
            shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'],
        });
        child.on('error', (error) => logger.warn({ event: 'speak_failed', errorCode: error.code }));
        child.stdin.end(text, 'utf8');
    };
}

function createMenuActions({ programs, statusWriter, session, logger, sessionLock }) {
    const notify = (text) => statusWriter.notify(text, session.getState());
    return {
        [TrayCommand.CLAUDE_ANSWER]: () => (fs.existsSync(paths.CLAUDE_ANSWER_TEXT_FILE)
            ? openInNotepad(paths.CLAUDE_ANSWER_TEXT_FILE) : notify('Ainda não há resposta do Claude.')),
        [TrayCommand.CLAUDE_LOCK]: () => {
            sessionLock.revoke();
            notify('Sessão do Claude Code encerrada. A próxima ordem vai pedir o PIN.');
        },
        [TrayCommand.CLAUDE_FOLDER]: (folder) => {
            try {
                notify(`Ordens do Claude Code vão para: ${programs.setClaudeFolder(folder)}`);
            } catch (error) {
                notify('Não consegui usar essa pasta.');
            }
        },
        [TrayCommand.CLAUDE_SET_PIN]: (pin) => {
            try {
                sessionLock.setPin(pin);
                notify('PIN do Claude Code definido. A Alexa vai pedir este PIN a cada 3 horas.');
            } catch (error) {
                notify(error.message);
            }
        },
        [TrayCommand.PROGRAMS_REFRESH]: async () => {
            notify('Procurando programas no menu Iniciar…');
            try {
                const { total, active } = await programs.refresh();
                notify(`Lista atualizada: ${total} programas (${active} ligados). Suas edições foram mantidas.`);
            } catch (error) {
                logger.warn({ event: 'programs_refresh_failed', errorName: error.name });
                notify(`Não consegui atualizar a lista: ${error.message}`);
            }
        },
        [TrayCommand.PROGRAMS_EDIT]: async () => openInNotepad(await programs.ensureFile()),
        [TrayCommand.ROUTINES]: () => openInNotepad(programs.writeRoutineSuggestions()),
        [TrayCommand.RENAME]: (name) => {
            try {
                notify(`Nome gravado: "${programs.setInvocationName(name)}". Use "Publicar atualização" para aplicar na Alexa.`);
            } catch (error) {
                notify(error.message);
            }
        },
        [TrayCommand.DEPLOY]: () => startDeploy(statusWriter, session.getState),
    };
}

function runDesktop() {
    const logger = createLocalLogger({ directory: paths.LOG_DIR, fileName: 'desktop.log', component: 'desktop' });
    installGlobalErrorHandlers(logger);
    const { config, localActions } = loadRuntimeConfig(logger);
    const statusWriter = createStatusFileWriter(paths.STATUS_FILE);
    const programs = createProgramsManager({
        files: paths,
        scanScript: assetPath('scan-programs.ps1', paths.SCAN_PROGRAMS_SCRIPT),
    });
    // A sessão (abaixo) ainda não existe aqui: o balão usa o último estado conhecido.
    let currentSession;
    const notify = (text) => statusWriter.notify(text, currentSession ? currentSession.getState() : undefined);
    const sessionLock = createSessionLock({ filePath: paths.CLAUDE_LOCK_FILE });
    const claudeJobs = createClaudeJobs({
        cli: createClaudeCli(),
        files: { answerFile: paths.CLAUDE_ANSWER_FILE, answerTextFile: paths.CLAUDE_ANSWER_TEXT_FILE, questionsDir: paths.CLAUDE_QUESTIONS_DIR },
        getProjectFolder: () => programs.claudeFolder(),
        speak: createSpeaker(logger),
        notify,
        logger,
    });
    const internalRunner = createInternalRunner({
        inputHelper: createInputHelper({ scriptPath: assetPath('input-helper.ps1', paths.INPUT_HELPER_SCRIPT), logger }),
        loadPrograms: () => programs.load(),
        launcher: createLauncher({ logger }),
        claudeJobs,
        sessionLock,
        notify,
        logger,
    });
    const session = createDesktopSession({
        endpointFile: paths.CORE_ENDPOINT_FILE,
        pipeSecret: config.pipeSecret,
        localActions,
        executor: createActionExecutor({ logger, internalRunner }),
        statusWriter,
        logger,
    });
    currentSession = session;
    session.start();
    // Primeira execução: cria a lista privada sozinha (o dono depois edita pelo menu).
    if (!fs.existsSync(paths.PROGRAMS_FILE)) {
        programs.refresh().catch((error) => logger.warn({ event: 'programs_first_scan_failed', errorName: error.name }));
    }
    startTray({
        trayScript: isPackagedInstall() ? paths.TRAY_SCRIPT : DEV_ASSET_PATHS['tray.ps1'],
        statusFile: paths.STATUS_FILE,
        logFile: path.join(paths.LOG_DIR, 'agent.log'),
        session,
        logger,
        menuActions: createMenuActions({ programs, statusWriter, session, logger, sessionLock }),
        onExit: () => {
            session.stop();
            process.exit(0);
        },
    });
}

async function main(argv) {
    const [command = '--instalar'] = argv;
    switch (command) {
        case '--nucleo':
            return runCore();
        case '--desktop':
            return runDesktop();
        case '--versao':
            console.log(`o-monstro ${VERSION}`);
            return undefined;
        case '--desinstalar':
            return require('./install/installer').runUninstall();
        case '--instalar':
            return require('./install/installer').runInstall(argv);
        default:
            console.error('Uso: node.exe o-monstro.cjs [--instalar | --desinstalar | --versao]');
            process.exitCode = EXIT_FAILURE;
            return undefined;
    }
}

/** No instalador a janela fecha sozinha; segura a mensagem de erro até o usuário ler. */
function waitForEnter() {
    if (!process.stdin.isTTY) return Promise.resolve();
    process.stdout.write('Pressione Enter para fechar');
    return new Promise((resolve) => {
        process.stdin.once('data', resolve);
        process.stdin.resume(); // o readline das perguntas deixa o stdin pausado; sem isso a janela fechava
    });
}

main(process.argv.slice(2)).catch(async (error) => {
    console.error(`Não foi possível concluir: ${error.message}`);
    process.exitCode = EXIT_FAILURE;
    await waitForEnter();
    process.exit(EXIT_FAILURE);
});
