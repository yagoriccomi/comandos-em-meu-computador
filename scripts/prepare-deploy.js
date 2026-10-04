'use strict';
/*
 * Prepara a cópia local da skill Alexa-hosted (clone do repositório da Amazon) para o deploy:
 *   1. espelha lambda/ do repositório (sem node_modules e sem testes);
 *   2. aplica os VERBOS da lista privada (programas.json) no catálogo e no modelo de voz;
 *   3. aplica o NOME DE CHAMADA das preferências (ex.: "a morgana") no modelo de voz.
 * Nada disso vai para o GitHub: só para o repositório interno da skill na Amazon.
 *
 * Uso: node scripts/prepare-deploy.js --clone <pasta do clone> [--preferences <arquivo>] [--programs <arquivo>]
 */
const fs = require('fs');
const path = require('path');

const REPO_DIR = path.resolve(__dirname, '..');
const LAMBDA_DIR = path.join(REPO_DIR, 'lambda');
const MODEL_FILE = path.join(REPO_DIR, 'interactionModels', 'custom', 'pt-BR.json');
const SKIPPED_ENTRIES = new Set(['node_modules', 'test', '.ask', '.git']);
const DEFAULT_INVOCATION_NAME = 'o monstro';
const INVOCATION_NAME_PATTERN = /^((o|a) )?[a-zà-ú]{2,20}( [a-zà-ú]{2,20}){0,2}$/;
const VERB_PATTERN = /^[a-zà-ú][a-zà-ú ]{1,29}$/;

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 2) args[argv[index].replace(/^--/, '')] = argv[index + 1];
    return args;
}

function readJson(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
}

function writeJson(filePath, value, indent) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, indent)}\n`);
}

/** Espelha src em dst, preservando node_modules do destino (o builder da Amazon instala de novo de qualquer forma). */
function mirrorDirectory(source, target) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(target)) {
        if (entry !== 'node_modules') fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    }
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (SKIPPED_ENTRIES.has(entry.name)) continue;
        fs.cpSync(path.join(source, entry.name), path.join(target, entry.name), { recursive: true });
    }
}

/**
 * Verbos da lista privada: cada grupo (abrir/fechar/destravar) passa a ter exatamente os verbos do arquivo.
 * Formas faladas conhecidas ("abre", "abra") vêm do catálogo; verbos novos entram só com a forma escrita.
 */
function applyPrivateVerbs(catalogSource, privateVerbs) {
    if (!privateVerbs || typeof privateVerbs !== 'object') return catalogSource;
    const used = new Set();
    const verbs = {};
    for (const [group, defaults] of Object.entries(catalogSource.verbs)) {
        const wanted = Array.isArray(privateVerbs[group]) ? privateVerbs[group] : Object.keys(defaults);
        verbs[group] = {};
        for (const raw of wanted) {
            const verb = String(raw).trim().toLowerCase();
            if (!VERB_PATTERN.test(verb) || used.has(verb)) continue;
            used.add(verb);
            verbs[group][verb] = defaults[verb] || [];
        }
        if (Object.keys(verbs[group]).length === 0) verbs[group] = defaults; // grupo vazio quebraria a frase
    }
    return { ...catalogSource, verbs };
}

function invocationNameFrom(preferences) {
    const name = String((preferences && preferences.nomeDeChamada) || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return INVOCATION_NAME_PATTERN.test(name) ? name : DEFAULT_INVOCATION_NAME;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.clone || !fs.existsSync(args.clone)) throw new Error('informe --clone com a pasta do clone da skill (ask init)');
    const cloneLambda = path.join(args.clone, 'lambda');
    mirrorDirectory(LAMBDA_DIR, cloneLambda);

    const catalogFile = path.join(cloneLambda, 'catalog', 'skill-catalog.json');
    const privateList = readJson(args.programs);
    const catalogSource = applyPrivateVerbs(readJson(catalogFile), privateList && privateList.verbos);
    writeJson(catalogFile, catalogSource, 4);

    // Gera o modelo com as mesmas regras do `npm run catalog:sync`, a partir do catálogo já com os verbos privados.
    const { buildCatalog } = require(path.join(LAMBDA_DIR, 'domain', 'catalog'));
    const { syncModel } = require(path.join(LAMBDA_DIR, 'scripts', 'sync-catalog'));
    const model = syncModel(readJson(MODEL_FILE), buildCatalog(catalogSource));
    const invocationName = invocationNameFrom(readJson(args.preferences));
    model.interactionModel.languageModel.invocationName = invocationName;
    writeJson(path.join(args.clone, 'skill-package', 'interactionModels', 'custom', 'pt-BR.json'), model, 2);

    console.log(`Código da skill copiado. Nome de chamada: "${invocationName}". Verbos: ${Object.values(catalogSource.verbs).map((group) => Object.keys(group).join('/')).join(' | ')}`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`Falha ao preparar o deploy: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { applyPrivateVerbs, invocationNameFrom, mirrorDirectory };
