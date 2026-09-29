'use strict';
/* Registro das duas tarefas agendadas do Windows (núcleo na inicialização, desktop no logon). */
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TASK_FOLDER = 'O Monstro';
const CORE_TASK = `\\${TASK_FOLDER}\\Nucleo`;
const DESKTOP_TASK = `\\${TASK_FOLDER}\\Area de trabalho`;
const USER_SID = /^S-1-5-21(-\d{1,10}){3,4}$/;
const SCHTASKS_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe');
const BOOT_DELAY = 'PT30S';
const RESTART_INTERVAL = 'PT1M';
const RESTART_COUNT = 999;

function escapeXml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function assertUserSid(userSid) {
    if (!USER_SID.test(userSid || '')) throw new Error('SID de usuário inválido');
}

function settingsXml() {
    return `  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>${RESTART_INTERVAL}</Interval><Count>${RESTART_COUNT}</Count></RestartOnFailure>
  </Settings>`;
}

/** Argumentos da tarefa: o bundle entre aspas (Program Files tem espaço) + o modo. */
function appArguments(appPath, mode) {
    if (String(appPath).includes('"')) throw new Error('caminho do aplicativo inválido');
    return `"${appPath}" ${mode}`;
}

function taskXml({ description, trigger, userSid, logonType, nodePath, appPath, mode }) {
    assertUserSid(userSid);
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>${escapeXml(description)}</Description></RegistrationInfo>
  <Triggers>${trigger}</Triggers>
  <Principals>
    <Principal id="Author"><UserId>${userSid}</UserId><LogonType>${logonType}</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
${settingsXml()}
  <Actions Context="Author"><Exec><Command>${escapeXml(nodePath)}</Command><Arguments>${escapeXml(appArguments(appPath, mode))}</Arguments></Exec></Actions>
</Task>
`;
}

/** Núcleo: sobe na inicialização do Windows, antes do logon, sem guardar senha (S4U). */
function coreTaskXml({ userSid, nodePath, appPath }) {
    return taskXml({
        description: 'O Monstro: núcleo do agente (executa ações pedidas pela Alexa). Inicia com o Windows.',
        trigger: `<BootTrigger><Enabled>true</Enabled><Delay>${BOOT_DELAY}</Delay></BootTrigger>`,
        userSid,
        logonType: 'S4U',
        nodePath,
        appPath,
        mode: '--nucleo',
    });
}

/** Sessão de desktop: sobe no logon do usuário (ícone na bandeja + ações de tela). */
function desktopTaskXml({ userSid, nodePath, appPath }) {
    assertUserSid(userSid);
    return taskXml({
        description: 'O Monstro: ícone na bandeja e ações que precisam da área de trabalho.',
        trigger: `<LogonTrigger><Enabled>true</Enabled><UserId>${userSid}</UserId></LogonTrigger>`,
        userSid,
        logonType: 'InteractiveToken',
        nodePath,
        appPath,
        mode: '--desktop',
    });
}

function runSchtasks(args, { ignoreFailure = false } = {}) {
    try {
        childProcess.execFileSync(SCHTASKS_EXE, args, { stdio: 'ignore', windowsHide: true });
        return true;
    } catch (error) {
        if (ignoreFailure) return false;
        throw new Error(`schtasks ${args[0]} falhou (código ${error.status})`);
    }
}

function registerTask(taskName, xml) {
    const xmlFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omonstro-task-')), 'task.xml');
    fs.writeFileSync(xmlFile, `\uFEFF${xml}`, 'utf16le');
    try {
        runSchtasks(['/Create', '/TN', taskName, '/XML', xmlFile, '/F']);
    } finally {
        fs.rmSync(path.dirname(xmlFile), { recursive: true, force: true });
    }
}

module.exports = {
    TASK_FOLDER,
    CORE_TASK,
    DESKTOP_TASK,
    USER_SID,
    coreTaskXml,
    desktopTaskXml,
    registerTask,
    runTask: (taskName) => runSchtasks(['/Run', '/TN', taskName], { ignoreFailure: true }),
    stopTask: (taskName) => runSchtasks(['/End', '/TN', taskName], { ignoreFailure: true }),
    deleteTask: (taskName) => runSchtasks(['/Delete', '/TN', taskName, '/F'], { ignoreFailure: true }),
};
