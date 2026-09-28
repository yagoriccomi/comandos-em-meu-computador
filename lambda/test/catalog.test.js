'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { catalog, buildCatalog, CatalogError } = require('../domain/catalog');
const { syncModel, serializeModel, MODEL_PATH } = require('../scripts/sync-catalog');

const VALID_ACTION = {
    id: 'abrir_teste',
    slotType: 'TIPO_APLICATIVO',
    synonyms: ['teste'],
    requiresConfirmation: false,
    requiresDesktop: true,
    params: [],
};

test('shouldKeepInteractionModelInSyncWithCatalog', () => {
    const current = fs.readFileSync(MODEL_PATH, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(current, serializeModel(syncModel(JSON.parse(current), catalog)),
        'Rode `npm run catalog:sync` em lambda/ depois de mudar o catálogo');
});

test('shouldUseInvocationNameOMonstro', () => {
    const model = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
    assert.equal(model.interactionModel.languageModel.invocationName, 'o monstro');
});

test('shouldMarkShutdownAndRestartAsRequiringConfirmation', () => {
    for (const id of ['desligar_em_minutos', 'reiniciar_pc', 'backup_documentos']) {
        assert.equal(catalog.findById(id).requiresConfirmation, true, id);
    }
});

test('shouldLimitShutdownMinutesBetween1And240', () => {
    const [minutes] = catalog.findById('desligar_em_minutos').params;
    assert.deepEqual([minutes.min, minutes.max, minutes.type], [1, 240, 'integer']);
});

test('shouldRejectDuplicatedIds', () => {
    assert.throws(() => buildCatalog({ actions: [VALID_ACTION, VALID_ACTION] }), CatalogError);
});

test('shouldRejectIdWithUnsafeCharacters', () => {
    assert.throws(() => buildCatalog({ actions: [{ ...VALID_ACTION, id: 'abrir;calc' }] }), CatalogError);
});

test('shouldRejectActionWithBothSlotTypeAndIntent', () => {
    assert.throws(() => buildCatalog({ actions: [{ ...VALID_ACTION, intent: 'XIntent' }] }), CatalogError);
});

test('shouldRejectActionWithoutConfirmationFlag', () => {
    const { requiresConfirmation, ...withoutFlag } = VALID_ACTION;
    assert.throws(() => buildCatalog({ actions: [withoutFlag] }), CatalogError);
});
