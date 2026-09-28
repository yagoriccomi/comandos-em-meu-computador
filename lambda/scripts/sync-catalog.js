'use strict';
/*
 * Gera os slot types do modelo de interação (pt-BR.json) a partir do catálogo público.
 * Uso: node scripts/sync-catalog.js           → reescreve o modelo
 *      node scripts/sync-catalog.js --check   → falha (exit 1) se o modelo estiver desatualizado
 */
const fs = require('fs');
const path = require('path');
const { catalog, SUPPORTED_SLOT_TYPES } = require('../domain/catalog');

const MODEL_PATH = path.resolve(__dirname, '../../interactionModels/custom/pt-BR.json');
const JSON_INDENT = 2;

function buildSlotTypes(sourceCatalog) {
    return SUPPORTED_SLOT_TYPES.map((typeName) => ({
        name: typeName,
        values: sourceCatalog.actions
            .filter((action) => action.slotType === typeName)
            .map((action) => ({
                id: action.id,
                name: { value: action.synonyms[0], synonyms: action.synonyms.slice(1) },
            })),
    }));
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
