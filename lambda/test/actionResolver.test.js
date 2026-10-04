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

test('shouldSendUnknownAppNameToPcAsTextOnly', () => {
    // O PC só COMPARA o texto com a lista privada; nada vira comando. Nem ids de outro tipo viram ação do catálogo.
    for (const [spoken, entityId] of [['cmd /c del', undefined], ['x', 'formatar_disco'], ['reiniciar', 'reiniciar_pc']]) {
        const result = resolveIntent({ name: 'AbrirAplicativoIntent', slots: slotWithMatch('aplicativo', spoken, entityId) }, catalog);
        assert.equal(result.action.id, 'abrir_programa', spoken);
        assert.deepEqual(result.params, { programa: spoken, verbo: 'abrir', exato: 0 });
    }
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

test('shouldSendProgramNameAndCanonicalVerbForOpenCloseAndUnlock', () => {
    const verbSlot = (spoken, id) => slotWithMatch('verbo', spoken, id);
    for (const [intentName, actionId, verbo] of [
        ['AbrirAplicativoIntent', 'abrir_programa', 'executar'],
        ['FecharAplicativoIntent', 'fechar_programa', 'encerrar'],
        ['DestravarAplicativoIntent', 'destravar_programa', 'destravar'],
    ]) {
        const slots = { ...slotWithMatch('aplicativo', 'epic', undefined), ...verbSlot('x', verbo) };
        const result = resolveIntent(intentWith(intentName, slots), catalog);
        assert.deepEqual([result.action.id, result.params], [actionId, { programa: 'epic', verbo, exato: 0 }], intentName);
    }
});

test('shouldUseDefaultVerbWhenSentenceHasNoVerbSlot', () => {
    const result = resolveIntent(intentWith('FecharAplicativoIntent', slotWithMatch('aplicativo', 'edge', undefined)), catalog);
    assert.equal(result.params.verbo, 'fechar');
});

test('shouldStillOpenCatalogAppThroughAppIntent', () => {
    const result = resolveIntent(intentWith('AbrirAplicativoIntent', slotWithMatch('aplicativo', 'netflix', 'abrir_netflix')), catalog);
    assert.equal(result.action.id, 'abrir_netflix');
});

test('shouldSendFreePhraseToPcWithAnyVerb', () => {
    const result = resolveIntent(intentWith('ExecutarRotinaIntent', slotWithMatch('rotina', 'alterna para a tv', undefined)), catalog);
    assert.deepEqual([result.action.id, result.params], ['abrir_programa', { programa: 'alterna para a tv', verbo: '*', exato: 0 }]);
    const routine = resolveIntent(intentWith('ExecutarRotinaIntent', slotWithMatch('rotina', 'pausar', 'pausar_continuar')), catalog);
    assert.equal(routine.action.id, 'pausar_continuar');
});

test('shouldAskWhichProgramWhenNameIsMissing', () => {
    const result = resolveIntent(intentWith('FecharAplicativoIntent', { aplicativo: { name: 'aplicativo' } }), catalog);
    assert.equal(result.reason, ResolutionFailure.MISSING_PARAM);
});

test('shouldRevalidatePendingTextAndProgramValues', () => {
    // As ações de texto/programa não pedem confirmação: pendência forjada com elas é recusada.
    const forged = resolvePendingAction({ actionId: 'pesquisar_google', params: { consulta: 'x' } }, catalog);
    assert.equal(forged.reason, ResolutionFailure.UNKNOWN_ACTION);
});

test('shouldPickProgramActionBySpokenVerbInTheSameIntent', () => {
    const slots = (verb) => ({ ...slotWithMatch('aplicativo', 'edge', undefined), ...slotWithMatch('verbo', verb, verb) });
    for (const [verb, actionId] of [['executar', 'abrir_programa'], ['fechar', 'fechar_programa'], ['reabrir', 'destravar_programa']]) {
        const result = resolveIntent(intentWith('AbrirAplicativoIntent', slots(verb)), catalog);
        assert.deepEqual([result.action.id, result.params.verbo], [actionId, verb]);
    }
    const closeNetflix = resolveIntent(intentWith('AbrirAplicativoIntent', {
        ...slotWithMatch('aplicativo', 'netflix', 'abrir_netflix'), ...slotWithMatch('verbo', 'fecha', 'fechar'),
    }), catalog);
    assert.deepEqual([closeNetflix.action.id, closeNetflix.params.programa], ['fechar_programa', 'netflix']);
});

// ---- Frases do Claude que a Alexa encaixou no intent genérico ----
const { detectClaudePhrase } = require('../domain/claudePhrase');

test('shouldRerouteClaudeCodeOrderCaughtAsProgram', () => {
    const slots = { ...slotWithMatch('verbo', 'mandar', undefined), ...slotWithMatch('aplicativo', 'o Claude Code no projeto gerador de imagens criar um teste', undefined) };
    const result = resolveIntent(intentWith('AbrirAplicativoIntent', slots), catalog);
    assert.deepEqual([result.action.id, result.params], ['claude_code_ordem', { ordem: 'no projeto gerador de imagens criar um teste' }]);
});

test('shouldRerouteClaudePhrasesCaughtAsFreePhrase', () => {
    const order = resolveIntent(intentWith('ExecutarRotinaIntent', slotWithMatch('rotina', 'manda pro cloud code rodar os testes', undefined)), catalog);
    assert.deepEqual([order.action.id, order.params], ['claude_code_ordem', { ordem: 'rodar os testes' }]);
    const question = resolveIntent(intentWith('ExecutarRotinaIntent', slotWithMatch('rotina', 'perguntar ao Cláudio qual é a capital da Austrália', undefined)), catalog);
    assert.deepEqual([question.action.id, question.params], ['perguntar_claude', { pergunta: 'qual é a capital da Austrália' }]);
});

test('shouldNotTreatOtherPhrasesAsClaude', () => {
    for (const phrase of ['abrir o discord', 'mandar mensagem no whatsapp', 'claude code', 'perguntar ao google o tempo', 'abrir o cloudflare']) {
        assert.equal(detectClaudePhrase(phrase), undefined, phrase);
    }
    assert.equal(resolveIntent(intentWith('AbrirAplicativoIntent', slotWithMatch('aplicativo', 'claude', undefined)), catalog).action.id, 'abrir_programa');
});
