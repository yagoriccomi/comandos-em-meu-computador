'use strict';
/*
 * Gera a pasta de instalação agent/dist/O Monstro/:
 *   Instalar O Monstro.cmd      dois cliques para instalar
 *   app/node.exe                Node.js OFICIAL, sem nenhuma alteração (assinatura da OpenJS Foundation)
 *   app/o-monstro.cjs           agente empacotado pelo esbuild (inclui protocolo e catálogo da skill)
 *   app/tray.ps1, app/actions.example.json
 *
 * Por que não um .exe único: injetar o código no node.exe invalida a assinatura digital e antivírus
 * (ex.: Kaspersky) bloqueiam o resultado. O Node oficial assinado é reconhecido como confiável.
 */
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const AGENT_DIR = path.resolve(__dirname, '..');
const PACKAGE_DIR = path.join(AGENT_DIR, 'dist', 'O Monstro');
const APP_DIR = path.join(PACKAGE_DIR, 'app');
const INSTALLER_SCRIPT = path.join(PACKAGE_DIR, 'Instalar O Monstro.cmd');
const MIN_NODE_MAJOR = 22;
const EXPECTED_SIGNER = 'OpenJS Foundation';
const UTF8_BOM = '\uFEFF';
const POWERSHELL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const INSTALLER_SCRIPT_CONTENT = [
    '@echo off',
    'rem Instalador do O Monstro: roda o agente com o Node.js oficial (assinado) que acompanha esta pasta.',
    '"%~dp0app\\node.exe" "%~dp0app\\o-monstro.cjs" --instalar',
    'if errorlevel 1 pause',
    '',
].join('\r\n');

/** Garante que vamos distribuir o node.exe original, com assinatura válida da OpenJS Foundation. */
function assertOfficialNodeRuntime(nodePath) {
    const command = `$s = Get-AuthenticodeSignature -LiteralPath '${nodePath.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
    const [status, subject = ''] = childProcess.execFileSync(POWERSHELL_EXE, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
        .trim().split('|');
    if (status !== 'Valid' || !subject.includes(EXPECTED_SIGNER)) {
        throw new Error(`o node.exe em uso não tem assinatura válida da ${EXPECTED_SIGNER} (${status}). Instale o Node.js oficial.`);
    }
}

async function main() {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor < MIN_NODE_MAJOR) throw new Error(`Node ${MIN_NODE_MAJOR}+ necessário`);
    assertOfficialNodeRuntime(process.execPath);

    fs.rmSync(PACKAGE_DIR, { recursive: true, force: true });
    fs.mkdirSync(APP_DIR, { recursive: true });

    console.log('1/3 empacotando o agente…');
    await esbuild.build({
        entryPoints: [path.join(AGENT_DIR, 'src', 'main.js')],
        bundle: true,
        platform: 'node',
        target: `node${nodeMajor}`,
        format: 'cjs',
        outfile: path.join(APP_DIR, 'o-monstro.cjs'),
        external: ['bufferutil', 'utf-8-validate'],
        legalComments: 'none',
        logLevel: 'warning',
    });

    console.log('2/3 copiando o Node.js oficial e os arquivos de apoio…');
    fs.copyFileSync(process.execPath, path.join(APP_DIR, 'node.exe'));
    const tray = fs.readFileSync(path.join(AGENT_DIR, 'src', 'desktop', 'tray.ps1'), 'utf8');
    fs.writeFileSync(path.join(APP_DIR, 'tray.ps1'), tray.startsWith(UTF8_BOM) ? tray : `${UTF8_BOM}${tray}`);
    fs.copyFileSync(path.join(AGENT_DIR, 'config', 'actions.example.json'), path.join(APP_DIR, 'actions.example.json'));

    console.log('3/3 criando o atalho de instalação…');
    fs.writeFileSync(INSTALLER_SCRIPT, INSTALLER_SCRIPT_CONTENT);

    console.log(`\nPronto: ${PACKAGE_DIR}`);
    console.log('Para instalar: dois cliques em "Instalar O Monstro.cmd".');
}

main().catch((error) => {
    console.error(`Falha ao gerar o pacote: ${error.message}`);
    process.exitCode = 1;
});
