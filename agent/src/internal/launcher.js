'use strict';
/*
 * Abre programas do menu Iniciar e URLs pelo explorer.exe (como um clique do usuário), sem shell.
 * O argumento é UM só: "shell:AppsFolder\<id do menu Iniciar>" (vindo da lista privada) ou a URL já codificada.
 */
const childProcess = require('child_process');
const path = require('path');

const EXPLORER_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
const APPS_FOLDER_PREFIX = 'shell:AppsFolder\\';
const HTTPS_URL = /^https:\/\/[^\s"]+$/;
const SAFE_APP_ID = /^[^\u0000-\u001f\u007f"]{1,512}$/;

function createLauncher({ spawn = childProcess.spawn, logger }) {
    function startExplorer(argument) {
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(EXPLORER_EXE, [argument], { shell: false, windowsHide: false, detached: true, stdio: 'ignore' });
            } catch (error) {
                logger.warn({ event: 'launch_failed', errorCode: error.code });
                resolve(false);
                return;
            }
            child.once('spawn', () => {
                child.unref();
                resolve(true);
            });
            child.once('error', (error) => {
                logger.warn({ event: 'launch_failed', errorCode: error.code });
                resolve(false);
            });
        });
    }

    return {
        openApp(appId) {
            if (typeof appId !== 'string' || !SAFE_APP_ID.test(appId)) return Promise.resolve(false);
            return startExplorer(`${APPS_FOLDER_PREFIX}${appId}`);
        },
        openUrl(url) {
            if (typeof url !== 'string' || !HTTPS_URL.test(url)) return Promise.resolve(false);
            return startExplorer(url);
        },
    };
}

module.exports = { createLauncher, EXPLORER_EXE, APPS_FOLDER_PREFIX };
