'use strict';
/*
 * Assistente de instalação/desinstalação do O Monstro (o próprio o-monstro.exe).
 * Roda como administrador; as tarefas criadas rodam como o usuário, sem privilégio elevado.
 */
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('../config/paths');
const { validateAgentConfig, loadAgentConfig } = require('../config/agentConfig');
const { isPackagedExe, readAsset } = require('../assets');
const { createConsolePrompt } = require('./consolePrompt');
const { normalizeBrokerUrl, isValidSkillId, generateIdentity, buildConfigFiles } = require('./secretsFactory');
const tasks = require('./windowsTasks');

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const POWERSHELL_EXE = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const SID_SYSTEM = '*S-1-5-18';
const SID_ADMINISTRATORS = '*S-1-5-32-544';
const MQTT_TEST_TIMEOUT_MS = 8000;
const MQTT_AUTH_ERROR_CODES = Object.freeze([4, 5, 134, 135]); // MQTT 3.1.1 e 5: usuário/senha ruins ou não autorizado
const DEFAULT_PC_USER = 'pc-o-monstro';
const DEFAULT_ALEXA_USER = 'alexa-o-monstro';
const USER_SID_ARG = '--usuario-sid=';
const UTF8_BOM = '\uFEFF';

function isElevated() {
    try {
        childProcess.execFileSync(path.join(SYSTEM32, 'net.exe'), ['session'], { stdio: 'ignore', windowsHide: true });
        return true;
    } catch (error) {
        return false;
    }
}

function currentUserSid() {
    const output = childProcess.execFileSync(path.join(SYSTEM32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = output.trim().split(',').pop().replace(/"/g, '');
    if (!tasks.USER_SID.test(sid)) throw new Error('não foi possível identificar o usuário do Windows');
    return sid;
}

function quotePowerShell(text) {
    return `'${String(text).replace(/'/g, "''")}'`;
}

/** Reabre este mesmo .exe pedindo permissão de administrador (UAC). */
function relaunchElevated(args) {
    const argumentList = args.map(quotePowerShell).join(',');
    const command = `Start-Process -FilePath ${quotePowerShell(process.execPath)} -ArgumentList @(${argumentList}) -Verb RunAs`;
    childProcess.execFileSync(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'ignore', windowsHide: true });
}

function userSidFromArgs(argv) {
    const arg = argv.find((value) => value.startsWith(USER_SID_ARG));
    return arg ? arg.slice(USER_SID_ARG.length) : currentUserSid();
}

async function testMqttLogin(url, username, password) {
    const mqtt = require('mqtt');
    try {
        const client = await mqtt.connectAsync(url, {
            username,
            password,
            reconnectPeriod: 0,
            connectTimeout: MQTT_TEST_TIMEOUT_MS,
            rejectUnauthorized: true,
            clientId: `teste-instalador-${process.pid}`,
        });
        await client.endAsync();
        return { ok: true };
    } catch (error) {
        const notAuthorized = MQTT_AUTH_ERROR_CODES.includes(error.code) || /not authorized|bad user ?name or password/i.test(String(error.message));
        return { ok: false, reason: notAuthorized ? 'credenciais recusadas' : 'servidor inacessível' };
    }
}

async function askCredentials(prompt, brokerUrl, label, defaultUser) {
    for (;;) {
        const username = await prompt.ask(`  Usuário da credencial ${label}`, { defaultValue: defaultUser });
        const password = await prompt.askUntilValid(`  Senha da credencial ${label} (não aparece ao digitar)`, Boolean, 'A senha não pode ficar vazia.', { hidden: true });
        prompt.say('  Testando a conexão…');
        const result = await testMqttLogin(brokerUrl, username, password);
        if (result.ok) {
            prompt.say('  ✔ Conectou.');
            return { username, password };
        }
        prompt.say(`  ✖ Não consegui conectar (${result.reason}). Confira usuário, senha e o endereço do cluster.`);
        if (!(await prompt.confirm('  Tentar de novo?'))) throw new Error('instalação cancelada pelo usuário');
    }
}

async function askAnswers(prompt) {
    prompt.say('\n1/3 · Servidor de mensagens (HiveMQ Cloud → Overview → Cluster URL)');
    const brokerInput = await prompt.askUntilValid('  Endereço do cluster', (value) => Boolean(normalizeBrokerUrl(value)),
        'Endereço inválido. Exemplo: abc123.s1.eu.hivemq.cloud');
    const brokerUrl = normalizeBrokerUrl(brokerInput);

    prompt.say('\n2/3 · Credenciais criadas em HiveMQ Cloud → Access Management');
    const pc = await askCredentials(prompt, brokerUrl, 'do PC', DEFAULT_PC_USER);
    const alexa = await askCredentials(prompt, brokerUrl, 'da Alexa', DEFAULT_ALEXA_USER);

    prompt.say('\n3/3 · Skill ID (developer.amazon.com → sua skill → "Copy Skill ID")');
    const skillId = await prompt.askUntilValid('  Skill ID', isValidSkillId, 'Formato esperado: amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    return { brokerUrl, pcUser: pc.username, pcPassword: pc.password, alexaUser: alexa.username, alexaPassword: alexa.password, skillId };
}

function restrictDataDirectory(userSid) {
    childProcess.execFileSync(path.join(SYSTEM32, 'icacls.exe'), [
        paths.DATA_DIR, '/inheritance:r',
        '/grant:r', `${SID_SYSTEM}:(OI)(CI)F`,
        '/grant:r', `${SID_ADMINISTRATORS}:(OI)(CI)F`,
        '/grant:r', `*${userSid}:(OI)(CI)M`,
        '/T', '/Q',
    ], { stdio: 'ignore', windowsHide: true });
}

function writeJson(filePath, content) {
    fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`);
}

function readExistingConfig() {
    try {
        return loadAgentConfig(paths.CONFIG_FILE);
    } catch (error) {
        return undefined;
    }
}

function installProgramFiles() {
    fs.mkdirSync(paths.INSTALL_DIR, { recursive: true });
    if (path.resolve(process.execPath).toLowerCase() !== path.resolve(paths.INSTALLED_EXE).toLowerCase()) {
        fs.copyFileSync(process.execPath, paths.INSTALLED_EXE);
    }
    const tray = readAsset('tray.ps1');
    fs.writeFileSync(paths.TRAY_SCRIPT, tray.startsWith(UTF8_BOM) ? tray : `${UTF8_BOM}${tray}`); // PowerShell 5.1 precisa do BOM
}

async function runInstall(argv) {
    if (!isPackagedExe()) throw new Error('O instalador só funciona a partir do o-monstro.exe (gere com: npm run build:exe).');
    if (!isElevated()) {
        relaunchElevated(['--instalar', `${USER_SID_ARG}${currentUserSid()}`]);
        return;
    }
    const userSid = userSidFromArgs(argv);
    const prompt = createConsolePrompt();
    try {
        prompt.say('==============================================');
        prompt.say('  O Monstro — instalação do agente');
        prompt.say('==============================================');

        let alexaSecretsFile;
        const existing = readExistingConfig();
        const keepExisting = existing && await prompt.confirm('\nJá existe uma instalação. Manter a configuração atual (recomendado)?');

        prompt.say('\nParando o agente, se estiver rodando…');
        tasks.stopTask(tasks.CORE_TASK);
        tasks.stopTask(tasks.DESKTOP_TASK);

        fs.mkdirSync(paths.LOG_DIR, { recursive: true });
        restrictDataDirectory(userSid);

        if (!keepExisting) {
            const answers = await askAnswers(prompt);
            const { agentConfig, alexaSecrets } = buildConfigFiles(generateIdentity(), answers);
            validateAgentConfig(agentConfig);
            writeJson(paths.CONFIG_FILE, agentConfig);
            fs.mkdirSync(paths.ALEXA_EXPORT_DIR, { recursive: true });
            alexaSecretsFile = path.join(paths.ALEXA_EXPORT_DIR, 'secrets.json');
            writeJson(alexaSecretsFile, alexaSecrets);
        }
        if (!fs.existsSync(paths.ACTIONS_FILE)) fs.writeFileSync(paths.ACTIONS_FILE, readAsset('actions.example.json'));

        prompt.say('\nCopiando o programa para Arquivos de Programas…');
        installProgramFiles();

        prompt.say('Registrando a inicialização automática…');
        tasks.registerTask(tasks.CORE_TASK, tasks.coreTaskXml({ userSid, exePath: paths.INSTALLED_EXE }));
        tasks.registerTask(tasks.DESKTOP_TASK, tasks.desktopTaskXml({ userSid, exePath: paths.INSTALLED_EXE }));
        tasks.runTask(tasks.CORE_TASK);
        tasks.runTask(tasks.DESKTOP_TASK);

        prompt.say('\n✔ Instalação concluída. O ícone do O Monstro deve aparecer perto do relógio.');
        prompt.say(`\nSuas ações ficam em: ${paths.ACTIONS_FILE}`);
        prompt.say(`Logs locais em:     ${paths.LOG_DIR}`);
        if (alexaSecretsFile) {
            prompt.say('\nPRÓXIMO PASSO (na publicação da skill):');
            prompt.say(`  Envie ${alexaSecretsFile}`);
            prompt.say('  para o S3 da skill (console da Alexa → Code → Media storage) com o nome config/secrets.json');
            prompt.say('  e depois APAGUE a cópia local. Ela contém a senha da credencial da Alexa.');
        }
        await prompt.ask('\nPressione Enter para fechar');
    } finally {
        prompt.close();
    }
}

function deleteTaskFolder() {
    const command = `$s = New-Object -ComObject Schedule.Service; $s.Connect(); $s.GetFolder('\\').DeleteFolder(${quotePowerShell(tasks.TASK_FOLDER)}, 0)`;
    try {
        childProcess.execFileSync(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
        // Pasta vazia no Agendador não atrapalha nada.
    }
}

function removeInstallDirectory() {
    const runningFromInstallDir = path.resolve(process.execPath).toLowerCase().startsWith(path.resolve(paths.INSTALL_DIR).toLowerCase());
    if (!runningFromInstallDir) {
        fs.rmSync(paths.INSTALL_DIR, { recursive: true, force: true });
        return;
    }
    // O .exe em uso não pode se apagar: agenda a remoção para alguns segundos depois de sair.
    const child = childProcess.spawn(path.join(SYSTEM32, 'cmd.exe'), ['/d', '/c', `ping -n 4 127.0.0.1 >nul & rmdir /s /q "${paths.INSTALL_DIR}"`], {
        detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
    });
    child.unref();
}

async function runUninstall() {
    if (!isElevated()) {
        relaunchElevated(['--desinstalar']);
        return;
    }
    const prompt = createConsolePrompt();
    try {
        prompt.say('O Monstro — desinstalação');
        if (!(await prompt.confirm('Remover o agente deste computador?', false))) return;
        const removeData = await prompt.confirm('Apagar também suas ações, configuração e logs?', false);
        for (const taskName of [tasks.CORE_TASK, tasks.DESKTOP_TASK]) {
            tasks.stopTask(taskName);
            tasks.deleteTask(taskName);
        }
        deleteTaskFolder();
        if (removeData) fs.rmSync(paths.DATA_DIR, { recursive: true, force: true });
        removeInstallDirectory();
        prompt.say('✔ Agente removido.');
        await prompt.ask('Pressione Enter para fechar');
    } finally {
        prompt.close();
    }
}

module.exports = { runInstall, runUninstall };
