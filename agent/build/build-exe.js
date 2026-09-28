'use strict';
/*
 * Gera agent/dist/o-monstro.exe:
 *   1. esbuild junta src/main.js + dependências (inclui protocolo e catálogo da skill) em um único .cjs
 *   2. Node Single Executable Application: gera o blob e injeta numa cópia do node.exe (postject)
 */
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const AGENT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(AGENT_DIR, 'dist');
const WORK_DIR = path.join(AGENT_DIR, '.sea-build');
const BUNDLE_FILE = path.join(WORK_DIR, 'o-monstro.cjs');
const BLOB_FILE = path.join(WORK_DIR, 'sea-prep.blob');
const SEA_CONFIG_FILE = path.join(WORK_DIR, 'sea-config.json');
const EXE_FILE = path.join(DIST_DIR, 'o-monstro.exe');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const MIN_NODE_MAJOR = 22;

function run(command, args) {
    childProcess.execFileSync(command, args, { stdio: 'inherit', cwd: AGENT_DIR });
}

async function main() {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor < MIN_NODE_MAJOR) throw new Error(`Node ${MIN_NODE_MAJOR}+ necessário para gerar o executável`);
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    fs.mkdirSync(WORK_DIR, { recursive: true });
    fs.mkdirSync(DIST_DIR, { recursive: true });

    console.log('1/3 empacotando o código…');
    await esbuild.build({
        entryPoints: [path.join(AGENT_DIR, 'src', 'main.js')],
        bundle: true,
        platform: 'node',
        target: `node${nodeMajor}`,
        format: 'cjs',
        outfile: BUNDLE_FILE,
        external: ['bufferutil', 'utf-8-validate'],
        legalComments: 'none',
        logLevel: 'warning',
    });

    console.log('2/3 gerando o blob do executável…');
    fs.writeFileSync(SEA_CONFIG_FILE, JSON.stringify({
        main: BUNDLE_FILE,
        output: BLOB_FILE,
        disableExperimentalSEAWarning: true,
        useCodeCache: false,
        useSnapshot: false,
        assets: {
            'tray.ps1': path.join(AGENT_DIR, 'src', 'desktop', 'tray.ps1'),
            'actions.example.json': path.join(AGENT_DIR, 'config', 'actions.example.json'),
        },
    }, null, 2));
    run(process.execPath, ['--experimental-sea-config', SEA_CONFIG_FILE]);

    console.log('3/3 injetando no executável…');
    fs.copyFileSync(process.execPath, EXE_FILE);
    run(process.execPath, [require.resolve('postject/dist/cli.js'), EXE_FILE, 'NODE_SEA_BLOB', BLOB_FILE, '--sentinel-fuse', SEA_FUSE]);

    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    console.log(`\nPronto: ${EXE_FILE}`);
}

main().catch((error) => {
    console.error(`Falha ao gerar o executável: ${error.message}`);
    process.exitCode = 1;
});
