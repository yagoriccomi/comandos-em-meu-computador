'use strict';
/*
 * Gera os slot types do modelo de interação (pt-BR.json) a partir do catálogo público.
 * Uso: node scripts/sync-catalog.js           → reescreve o modelo
 *      node scripts/sync-catalog.js --check   → falha (exit 1) se o modelo estiver desatualizado
 */
const fs = require('fs');
const path = require('path');
const { catalog } = require('../domain/catalog');

const MODEL_PATH = path.resolve(__dirname, '../../interactionModels/custom/pt-BR.json');
const JSON_INDENT = 2;

/** Respostas a "qual deles?". Qualquer outra palavra também chega (slot livre) e vira busca pelo nome. */
const CHOICE_VALUES = Object.freeze([
    { id: '1', name: { value: 'primeiro', synonyms: ['primeira', 'o primeiro', 'a primeira', 'um', 'número um', 'opção um'] } },
    { id: '2', name: { value: 'segundo', synonyms: ['segunda', 'o segundo', 'a segunda', 'dois', 'número dois', 'opção dois'] } },
    { id: '3', name: { value: 'terceiro', synonyms: ['terceira', 'o terceiro', 'a terceira', 'três', 'número três', 'opção três'] } },
]);

function catalogValues(sourceCatalog, typeName) {
    return sourceCatalog.actions
        .filter((action) => action.slotType === typeName)
        .map((action) => ({ id: action.id, name: { value: action.synonyms[0], synonyms: action.synonyms.slice(1) } }));
}

/** Nomes genéricos só treinam o slot livre: a busca de verdade acontece no PC, na lista privada. */
function exampleValues(sourceCatalog) {
    return sourceCatalog.programExamples.map((example, index) => ({ id: `exemplo_${index + 1}`, name: { value: example } }));
}

/** Um único tipo com todos os verbos: o verbo falado decide se a frase é abrir, fechar ou destravar. */
function verbType(sourceCatalog) {
    const values = Object.values(sourceCatalog.verbs).flatMap((verbs) => Object.entries(verbs)
        .map(([canonical, spoken]) => ({ id: canonical, name: { value: canonical, synonyms: spoken.filter((form) => form !== canonical) } })));
    return { name: 'TIPO_VERBO', values };
}

function buildSlotTypes(sourceCatalog) {
    return [
        { name: 'TIPO_APLICATIVO', values: [...catalogValues(sourceCatalog, 'TIPO_APLICATIVO'), ...exampleValues(sourceCatalog)] },
        { name: 'TIPO_ROTINA', values: catalogValues(sourceCatalog, 'TIPO_ROTINA') },
        verbType(sourceCatalog),
        { name: 'TIPO_ESCOLHA', values: CHOICE_VALUES },
    ];
}

function syncModel(model, sourceCatalog) {
    const languageModel = model.interactionModel.languageModel;
    return {
        ...model,
        interactionModel: {
            ...model.interactionModel,
            languageModel: { ...languageModel, types: buildSlotTypes(sourceCatalog) },
        },
    };
}

function serializeModel(model) {
    return `${JSON.stringify(model, null, JSON_INDENT)}\n`;
}

function main() {
    const current = fs.readFileSync(MODEL_PATH, 'utf8');
    const expected = serializeModel(syncModel(JSON.parse(current), catalog));
    const isUpToDate = current.replace(/\r\n/g, '\n') === expected;
    if (process.argv.includes('--check')) {
        if (!isUpToDate) {
            console.error('Modelo de interação desatualizado. Rode: npm run catalog:sync');
            process.exitCode = 1;
        }
        return;
    }
    if (!isUpToDate) fs.writeFileSync(MODEL_PATH, expected);
    console.log(isUpToDate ? 'Modelo já sincronizado.' : 'Modelo de interação atualizado a partir do catálogo.');
}

if (require.main === module) main();

module.exports = { buildSlotTypes, syncModel, serializeModel, MODEL_PATH };
