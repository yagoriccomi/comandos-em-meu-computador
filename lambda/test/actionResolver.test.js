'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { catalog } = require('../domain/catalog');
const { resolveIntent, ResolutionFailure } = require('../domain/actionResolver');

function slotWithMatch(name, spokenValue, entityId) {
    return {
        [name]: {
            name,
            value: spokenValue,
            resolutions: {
                resolutionsPerAuthority: [{
                    authority: 'amzn1.er-authority.echo-sdk.test',
                    status: { code: entityId ? 'ER_SUCCESS_MATCH' : 'ER_SUCCESS_NO_MATCH' },
                    values: entityId ? [{ value: { name: spokenValue, id: entityId } }] : [],
                }],
            },
        },
    };
}

function shutdownIntent(minutos) {
    return { name: 'DesligarEmMinutosIntent', slots: { minutos: { name: 'minutos', value: minutos } } };
}

test('shouldMapAppSlotToActionId', () => {
    const result = resolveIntent({ name: 'AbrirAplicativoIntent', slots: slotWithMatch('aplicativo', 'netflix', 'abrir_netflix') }, catalog);
    assert.equal(result.ok, true);
    assert.equal(result.action.id, 'abrir_netflix');
    assert.deepEqual(result.params, {});
});

test('shouldMapRoutineSlotToActionId', () => {
    const result = resolveIntent({ name: 'ExecutarRotinaIntent', slots: slotWithMatch('rotina', 'o backup', 'backup_documentos') }, catalog);
    assert.equal(result.action.id, 'backup_documentos');
});

test('shouldRejectSpokenValueWithoutCatalogMatch', () => {
    const result = resolveIntent({ name: 'AbrirAplicativoIntent', slots: slotWithMatch('aplicativo', 'cmd /c del', undefined) }, catalog);
    assert.deepEqual(result, { ok: false, reason: ResolutionFailure.UNKNOWN_ACTION });
});

test('shouldRejectEntityIdThatIsNotInCatalog', () => {
    const result = resolveIntent({ name: 'AbrirAplicativoIntent', slots: slotWithMatch('aplicativo', 'x', 'formatar_disco') }, catalog);
    assert.equal(result.reason, ResolutionFailure.UNKNOWN_ACTION);
});

test('shouldRejectActionFromAnotherSlotType', () => {
    const result = resolveIntent({ name: 'AbrirAplicativoIntent', slots: slotWithMatch('aplicativo', 'reiniciar', 'reiniciar_pc') }, catalog);
    assert.equal(result.reason, ResolutionFailure.UNKNOWN_ACTION);
});

test('shouldRejectUnknownIntent', () => {
    assert.equal(resolveIntent({ name: 'FormatarDiscoIntent' }, catalog).reason, ResolutionFailure.UNKNOWN_ACTION);
    assert.equal(resolveIntent(undefined, catalog).reason, ResolutionFailure.UNKNOWN_ACTION);
});

test('shouldAcceptShutdownMinutesInsideRange', () => {
    for (const minutos of ['1', '30', '240']) {
        const result = resolveIntent(shutdownIntent(minutos), catalog);
        assert.equal(result.ok, true);
        assert.deepEqual(result.params, { minutos: Number(minutos) });
    }
});

test('shouldRejectShutdownMinutesOutsideRangeOrNotInteger', () => {
    for (const minutos of ['0', '241', '2.5', '-5', '?', '30; shutdown /r', '9999999']) {
        assert.equal(resolveIntent(shutdownIntent(minutos), catalog).reason, ResolutionFailure.INVALID_PARAM, minutos);
    }
});

test('shouldReportMissingShutdownMinutes', () => {
    const result = resolveIntent(shutdownIntent(undefined), catalog);
    assert.equal(result.reason, ResolutionFailure.MISSING_PARAM);
    assert.equal(result.missingSlot, 'minutos');
});
