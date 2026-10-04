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

// ---- Tipos novos: duração, texto, programa da lista privada e inteiro com default ----
const { parseIsoDurationSeconds, resolvePendingAction } = require('../domain/actionResolver');

const PROGRAM_ID = 'p0123456789ab';

function intentWith(name, slots) {
    return { name, slots };
}

test('shouldConvertSpokenDurationToSeconds', () => {
    assert.equal(parseIsoDurationSeconds('PT30S'), 30);
    assert.equal(parseIsoDurationSeconds('PT1M30S'), 90);
    assert.equal(parseIsoDurationSeconds('PT2H'), 7200);
    for (const invalid of ['P1D', 'PT', 'PT1.5M', '30', 'PT1M30S; shutdown', '']) {
        assert.equal(parseIsoDurationSeconds(invalid), undefined, invalid);
    }
});

test('shouldResolveSeekWithDurationInSeconds', () => {
    const result = resolveIntent(intentWith('AvancarIntent', { tempo: { name: 'tempo', value: 'PT2M' } }), catalog);
    assert.equal(result.action.id, 'avancar_tempo');
    assert.deepEqual(result.params, { segundos: 120 });
});

test('shouldAskForTimeWhenSeekHasNoDuration', () => {
    const result = resolveIntent(intentWith('VoltarIntent', { tempo: { name: 'tempo' } }), catalog);
    assert.equal(result.reason, ResolutionFailure.MISSING_PARAM);
});

test('shouldRejectDurationOutOfRange', () => {
    const result = resolveIntent(intentWith('VoltarIntent', { tempo: { name: 'tempo', value: 'PT4H' } }), catalog);
    assert.equal(result.reason, ResolutionFailure.INVALID_PARAM);
});

test('shouldUseDefaultVolumeStepWhenNoNumberIsSpoken', () => {
    const result = resolveIntent(intentWith('AumentarVolumeIntent', { quantidade: { name: 'quantidade' } }), catalog);
    assert.deepEqual([result.action.id, result.params], ['aumentar_volume', { quantidade: 20 }]);
    const spoken = resolveIntent(intentWith('AbaixarVolumeIntent', { quantidade: { name: 'quantidade', value: '40' } }), catalog);
    assert.deepEqual(spoken.params, { quantidade: 40 });
});

test('shouldKeepSearchTextAndRejectLongOrControlText', () => {
    const ok = resolveIntent(intentWith('PesquisarIntent', { consulta: { name: 'consulta', value: '  receita de bolo  ' } }), catalog);
    assert.deepEqual(ok.params, { consulta: 'receita de bolo' });
    for (const value of ['x'.repeat(201), 'linha\nnova']) {
        const result = resolveIntent(intentWith('PesquisarIntent', { consulta: { name: 'consulta', value } }), catalog);
        assert.equal(result.reason, ResolutionFailure.INVALID_PARAM);
    }
});

test('shouldMapPrivateProgramToOpenCloseAndUnlockActions', () => {
    const slots = slotWithMatch('aplicativo', 'discord', PROGRAM_ID);
    for (const [intentName, actionId] of [
        ['AbrirAplicativoIntent', 'abrir_programa'],
        ['FecharAplicativoIntent', 'fechar_programa'],
        ['DestravarAplicativoIntent', 'destravar_programa'],
    ]) {
        const result = resolveIntent(intentWith(intentName, slots), catalog);
        assert.deepEqual([result.action.id, result.params], [actionId, { programa: PROGRAM_ID }], intentName);
    }
});

test('shouldStillOpenCatalogAppThroughAppIntent', () => {
    const result = resolveIntent(intentWith('AbrirAplicativoIntent', slotWithMatch('aplicativo', 'netflix', 'abrir_netflix')), catalog);
    assert.equal(result.action.id, 'abrir_netflix');
});

test('shouldNotCloseCatalogAppOrUnknownProgram', () => {
    for (const slots of [slotWithMatch('aplicativo', 'netflix', 'abrir_netflix'), slotWithMatch('aplicativo', 'xyz', undefined),
        slotWithMatch('aplicativo', 'x', 'p12; del'), { aplicativo: { name: 'aplicativo' } }]) {
        const result = resolveIntent(intentWith('FecharAplicativoIntent', slots), catalog);
        assert.equal(result.reason, ResolutionFailure.UNKNOWN_ACTION);
    }
});

test('shouldRevalidatePendingTextAndProgramValues', () => {
    // As ações de texto/programa não pedem confirmação: pendência forjada com elas é recusada.
    const forged = resolvePendingAction({ actionId: 'pesquisar_google', params: { consulta: 'x' } }, catalog);
    assert.equal(forged.reason, ResolutionFailure.UNKNOWN_ACTION);
});
