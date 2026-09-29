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
const { startTray } = require('./desktop/trayController');
const { isPackagedInstall, DEV_ASSET_PATHS } = require('./assets');

const VERSION = '1.0.0';
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

function runDesktop() {
    const logger = createLocalLogger({ directory: paths.LOG_DIR, fileName: 'desktop.log', component: 'desktop' });
    installGlobalErrorHandlers(logger);
    const { config, localActions } = loadRuntimeConfig(logger);
    const session = createDesktopSession({
        endpointFile: paths.CORE_ENDPOINT_FILE,
        pipeSecret: config.pipeSecret,
        localActions,
        executor: createActionExecutor({ logger }),
        statusWriter: createStatusFileWriter(paths.STATUS_FILE),
        logger,
    });
    session.start();
    startTray({
        trayScript: isPackagedInstall() ? paths.TRAY_SCRIPT : DEV_ASSET_PATHS['tray.ps1'],
        statusFile: paths.STATUS_FILE,
        logFile: path.join(paths.LOG_DIR, 'agent.log'),
        session,
        logger,
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
