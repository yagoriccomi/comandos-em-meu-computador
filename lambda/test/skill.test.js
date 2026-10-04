'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('../protocol/message');
const { createSkill } = require('../index');
const { hashUserId } = require('../handlers/actionHandler');
const { createMemoryBroker } = require('./support/memoryBroker');

const SKILL_ID = 'amzn1.ask.skill.11111111-2222-3333-4444-555555555555';
const USER_ID = 'amzn1.ask.account.TESTE';
const SECRETS = Object.freeze({
    skillId: SKILL_ID,
    deviceId: 'pc-teste-1234',
    hmacSecret: 'k'.repeat(43),
    mqtt: { url: 'mqtts://broker.test:8883', username: 'u', password: 'p' },
    allowedUserIdHashes: [],
});

function envelope(request, { skillId = SKILL_ID, attributes, isNewSession = true } = {}) {
    return {
        version: '1.0',
        session: { new: isNewSession, sessionId: 'sessao', application: { applicationId: skillId }, user: { userId: USER_ID }, attributes },
        context: { System: { application: { applicationId: skillId }, user: { userId: USER_ID }, device: { deviceId: 'eco' } } },
        request: { requestId: 'req', timestamp: new Date().toISOString(), locale: 'pt-BR', ...request },
    };
}

function intentRequest(name, slots = {}, options = {}) {
    return envelope({ type: 'IntentRequest', dialogState: 'STARTED', intent: { name, confirmationStatus: 'NONE', slots } }, options);
}

/** Resposta do usuário no turno seguinte, levando os atributos de sessão devolvidos pela skill (como a Alexa faz). */
function followUp(previousResponse, intentName, slots = {}) {
    return intentRequest(intentName, slots, { attributes: previousResponse.sessionAttributes, isNewSession: false });
}

function matchedSlot(name, value, id) {
    return { [name]: { name, value, confirmationStatus: 'NONE', resolutions: { resolutionsPerAuthority: [
        { authority: 'a', status: { code: 'ER_SUCCESS_MATCH' }, values: [{ value: { name: value, id } }] },
    ] } } };
}

/** Monta a skill com broker em memória e um agente falso que responde `agentStatus` (ou não responde). */
async function buildSkill({ secrets = SECRETS, agentStatus } = {}) {
    const broker = createMemoryBroker();
    const executed = [];
    const logs = [];
    if (agentStatus) {
        const agent = broker.connect();
        await agent.subscribe(protocol.commandTopic(secrets.deviceId), async (raw) => {
            const command = protocol.verify(protocol.parse(raw), { secret: secrets.hmacSecret, expectedType: protocol.MessageType.COMMAND });
            executed.push({ actionId: command.actionId, params: command.params });
            // agentStatus: 'ok' | 'error' ou função (command) => { status, choices } para simular a busca de programas.
            const reply = typeof agentStatus === 'function' ? agentStatus(command) : { status: agentStatus };
            const ack = protocol.createAck({ requestId: command.requestId, ...reply }, secrets.hmacSecret);
            await agent.publish(protocol.ackTopic(secrets.deviceId), protocol.serialize(ack));
        });
    }
    const log = { info: (fields) => logs.push(fields), error: (fields) => logs.push(fields) };
    const skill = createSkill({
        loadSecrets: async () => secrets,
        connectTransport: async () => broker.connect(),
        log,
    }).create();
    return { skill, executed, logs, broker };
}

function speechOf(response) {
    return response.response.outputSpeech.ssml.replace(/<\/?speak>/g, '');
}

test('shouldSayDoneWhenAgentExecutesApp', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(speechOf(response), 'Feito.');
    assert.deepEqual(executed, [{ actionId: 'abrir_netflix', params: {} }]);
});

test('shouldSayCouldNotWhenAgentReportsError', async () => {
    const { skill } = await buildSkill({ agentStatus: 'error' });
    const response = await skill.invoke(intentRequest('ExecutarRotinaIntent', matchedSlot('rotina', 'bloquear a tela', 'bloquear_tela')));
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
});

test('shouldSendUnmatchedAppNameToPcAsText', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    const slots = { aplicativo: { name: 'aplicativo', value: 'powershell', resolutions: { resolutionsPerAuthority: [
        { authority: 'a', status: { code: 'ER_SUCCESS_NO_MATCH' } }] } } };
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', slots));
    assert.equal(speechOf(response), 'Feito.');
    assert.deepEqual(executed, [{ actionId: 'abrir_programa', params: { programa: 'powershell', verbo: 'abrir', exato: 0 } }]);
});

const SHUTDOWN_30 = { minutos: { name: 'minutos', value: '30' } };

test('shouldAskConfirmationAndKeepSessionOpenBeforeSensitiveAction', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('DesligarEmMinutosIntent', SHUTDOWN_30));
    assert.equal(speechOf(response), 'Você confirma desligar o computador em 30 minutos?');
    assert.equal(response.response.shouldEndSession, false, 'o microfone precisa ficar aberto para ouvir o "sim"');
    assert.equal(response.response.directives, undefined, 'sem Dialog.ConfirmIntent (exige modelo de diálogo)');
    assert.deepEqual(response.sessionAttributes.pendingAction.params, { minutos: 30 });
    assert.equal(broker.published.length, 0);
});

test('shouldExecuteSensitiveActionWhenUserSaysYes', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    const question = await skill.invoke(intentRequest('DesligarEmMinutosIntent', SHUTDOWN_30));
    const answer = await skill.invoke(followUp(question, 'AMAZON.YesIntent'));
    assert.equal(speechOf(answer), 'Feito.');
    assert.deepEqual(executed, [{ actionId: 'desligar_em_minutos', params: { minutos: 30 } }]);
    assert.equal(answer.sessionAttributes.pendingAction, undefined, 'confirmação é consumida');
});

test('shouldDoNothingWhenUserSaysNo', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const question = await skill.invoke(intentRequest('ExecutarRotinaIntent', matchedSlot('rotina', 'reiniciar', 'reiniciar_pc')));
    const answer = await skill.invoke(followUp(question, 'AMAZON.NoIntent'));
    assert.equal(speechOf(answer), 'Tudo bem, não fiz nada.');
    assert.equal(broker.published.length, 0);
});

test('shouldNotExecuteWhenYesArrivesWithoutPendingAction', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('AMAZON.YesIntent'));
    assert.equal(speechOf(response), 'Não conheço essa ação.');
    assert.equal(broker.published.length, 0);
});

test('shouldRefuseExpiredConfirmation', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const expired = { pendingAction: { actionId: 'reiniciar_pc', params: {}, expiresAt: Date.now() - 1 } };
    const response = await skill.invoke(intentRequest('AMAZON.YesIntent', {}, { attributes: expired, isNewSession: false }));
    assert.equal(speechOf(response), 'Demorou demais para confirmar. Peça de novo, por favor.');
    assert.equal(broker.published.length, 0);
});

test('shouldRevalidateTamperedPendingActionBeforeSending', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const future = Date.now() + 60000;
    for (const pendingAction of [
        { actionId: 'formatar_disco', params: {}, expiresAt: future },
        { actionId: 'abrir_netflix', params: {}, expiresAt: future },
        { actionId: 'desligar_em_minutos', params: { minutos: 999 }, expiresAt: future },
        { actionId: 'desligar_em_minutos', params: { minutos: '30; shutdown /r' }, expiresAt: future },
        { actionId: 'desligar_em_minutos', params: { minutos: 30, extra: 1 }, expiresAt: future },
    ]) {
        await skill.invoke(intentRequest('AMAZON.YesIntent', {}, { attributes: { pendingAction }, isNewSession: false }));
    }
    assert.equal(broker.published.length, 0);
});

test('shouldAskForMinutesKeepingSessionOpenAndAcceptSpokenAnswer', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    const question = await skill.invoke(intentRequest('DesligarEmMinutosIntent', { minutos: { name: 'minutos' } }));
    assert.equal(speechOf(question), 'Em quantos minutos? Diga, por exemplo: 30 minutos.');
    assert.equal(question.response.shouldEndSession, false);
    const confirmation = await skill.invoke(followUp(question, 'DesligarEmMinutosIntent', { minutos: { name: 'minutos', value: '15' } }));
    assert.equal(speechOf(confirmation), 'Você confirma desligar o computador em 15 minutos?');
    await skill.invoke(followUp(confirmation, 'AMAZON.YesIntent'));
    assert.deepEqual(executed, [{ actionId: 'desligar_em_minutos', params: { minutos: 15 } }]);
});

test('shouldRefuseMinutesOutOfRange', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('DesligarEmMinutosIntent', { minutos: { name: 'minutos', value: '500' } }));
    assert.equal(speechOf(response), 'O valor precisa ser de 1 a 240 minutos.');
    assert.equal(broker.published.length, 0);
});

test('shouldSayCouldNotWhenAgentDoesNotAnswer', async () => {
    const { skill } = await buildSkill();
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
});

test('shouldRejectRequestFromAnotherSkill', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const request = envelope({ type: 'IntentRequest', intent: { name: 'AbrirAplicativoIntent', confirmationStatus: 'NONE',
        slots: matchedSlot('aplicativo', 'netflix', 'abrir_netflix') } }, { skillId: 'amzn1.ask.skill.outra' });
    const response = await skill.invoke(request);
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
    assert.equal(broker.published.length, 0);
});

test('shouldRejectUserOutsideAllowListWhenConfigured', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok', secrets: { ...SECRETS, allowedUserIdHashes: ['0'.repeat(64)] } });
    await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(broker.published.length, 0);
});

test('shouldAcceptUserInsideAllowList', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok', secrets: { ...SECRETS, allowedUserIdHashes: [hashUserId(USER_ID)] } });
    await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(executed.length, 1);
});

test('shouldAnswerGenericallyWhenSecretsFail', async () => {
    const logs = [];
    const skill = createSkill({
        loadSecrets: async () => { throw Object.assign(new Error('boom'), { code: 'invalid_hmac_secret' }); },
        connectTransport: async () => { throw new Error('não deveria conectar'); },
        log: { info: (f) => logs.push(f), error: (f) => logs.push(f) },
    }).create();
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    assert.equal(speechOf(response), 'Não consegui executar essa ação.');
    assert.equal(logs[0].errorCode, 'invalid_hmac_secret');
});

test('shouldNeverLogPersonalData', async () => {
    const { skill, logs } = await buildSkill({ agentStatus: 'ok' });
    await skill.invoke(intentRequest('AbrirAplicativoIntent', matchedSlot('aplicativo', 'netflix', 'abrir_netflix')));
    await skill.invoke(envelope({ type: 'SessionEndedRequest', reason: 'USER_INITIATED' }));
    const serialized = JSON.stringify(logs);
    assert.ok(!serialized.includes(USER_ID));
    assert.ok(!serialized.includes('eco'));
    assert.deepEqual(Object.keys(logs[0]).sort(), ['actionId', 'event', 'requestId', 'result']);
});

test('shouldNotEchoUnknownIntentName', async () => {
    const { skill } = await buildSkill();
    const response = await skill.invoke(intentRequest('AMAZON.FallbackIntent'));
    assert.equal(speechOf(response), 'Não conheço essa ação.');
});

test('shouldSendSearchTextSignedToAgentWithoutLoggingIt', async () => {
    const { skill, executed, logs } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('PesquisarIntent', { consulta: { name: 'consulta', value: 'meu segredo de pesquisa' } }));
    assert.equal(speechOf(response), 'Feito.');
    assert.deepEqual(executed, [{ actionId: 'pesquisar_google', params: { consulta: 'meu segredo de pesquisa' } }]);
    assert.ok(!JSON.stringify(logs).includes('segredo'), 'o texto da pesquisa nunca vai para o log');
});

test('shouldAskWhatToSearchWhenQueryIsMissing', async () => {
    const { skill, broker } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('PesquisarIntent', { consulta: { name: 'consulta' } }));
    assert.equal(speechOf(response), 'O que você quer pesquisar?');
    assert.equal(response.response.shouldEndSession, false);
    assert.equal(broker.published.length, 0);
});

test('shouldRaiseVolumeByDefaultStep', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    await skill.invoke(intentRequest('AumentarVolumeIntent', { quantidade: { name: 'quantidade' } }));
    assert.deepEqual(executed, [{ actionId: 'aumentar_volume', params: { quantidade: 20 } }]);
});

test('shouldCloseProgramByName', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    await skill.invoke(intentRequest('FecharAplicativoIntent', { aplicativo: { name: 'aplicativo', value: 'edge' } }));
    assert.deepEqual(executed, [{ actionId: 'fechar_programa', params: { programa: 'edge', verbo: 'fechar', exato: 0 } }]);
});

// ---- Diálogo "qual deles?" (o PC achou vários programas parecidos) ----
function cloudflareAgent(command) {
    if (command.params.exato === 1) return { status: 'ok' };
    return { status: 'ambiguous', choices: ['Cloudflare WARP', 'Cloudflare One'] };
}

test('shouldAskWhichProgramAndOpenTheOneChosenByOrdinal', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: cloudflareAgent });
    const question = await skill.invoke(intentRequest('AbrirAplicativoIntent', { aplicativo: { name: 'aplicativo', value: 'cloudflare' } }));
    assert.equal(speechOf(question), 'Encontrei Cloudflare WARP e Cloudflare One. Qual deles?');
    assert.equal(question.response.shouldEndSession, false);
    const answer = await skill.invoke(followUp(question, 'EscolhaIntent', { escolha: { name: 'escolha', value: 'o segundo' } }));
    assert.equal(speechOf(answer), 'Feito.');
    assert.deepEqual(executed[1], { actionId: 'abrir_programa', params: { programa: 'Cloudflare One', verbo: 'abrir', exato: 1 } });
});

test('shouldAcceptProgramNameAsAnswerThroughAnyIntent', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: cloudflareAgent });
    const question = await skill.invoke(intentRequest('AbrirAplicativoIntent', { aplicativo: { name: 'aplicativo', value: 'cloudflare' } }));
    await skill.invoke(followUp(question, 'ExecutarRotinaIntent', { rotina: { name: 'rotina', value: 'cloudflare warp' } }));
    assert.equal(executed[1].params.programa, 'Cloudflare WARP');
});

test('shouldOfferSimilarProgramAndAcceptYes', async () => {
    const agent = (command) => (command.params.exato === 1 ? { status: 'ok' } : { status: 'not_found', choices: ['Discord'] });
    const { skill, executed } = await buildSkill({ agentStatus: agent });
    const question = await skill.invoke(intentRequest('AbrirAplicativoIntent', { aplicativo: { name: 'aplicativo', value: 'discordi' } }));
    assert.equal(speechOf(question), 'Não achei esse programa. Você quis dizer Discord?');
    const answer = await skill.invoke(followUp(question, 'AMAZON.YesIntent'));
    assert.equal(speechOf(answer), 'Feito.');
    assert.equal(executed[1].params.programa, 'Discord');
});

test('shouldSayNotFoundWhenPcHasNoSimilarProgram', async () => {
    const { skill } = await buildSkill({ agentStatus: () => ({ status: 'not_found', choices: [] }) });
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', { aplicativo: { name: 'aplicativo', value: 'xyz' } }));
    assert.equal(speechOf(response), 'Não achei esse programa no computador.');
});

test('shouldNotExecuteWhenChoiceIsNotUnderstoodOrCancelled', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: cloudflareAgent });
    const question = await skill.invoke(intentRequest('AbrirAplicativoIntent', { aplicativo: { name: 'aplicativo', value: 'cloudflare' } }));
    const unclear = await skill.invoke(followUp(question, 'EscolhaIntent', { escolha: { name: 'escolha', value: 'banana' } }));
    assert.equal(speechOf(unclear), 'Não entendi qual deles. Peça de novo, por favor.');
    const cancelled = await skill.invoke(followUp(question, 'AMAZON.NoIntent'));
    assert.equal(speechOf(cancelled), 'Tudo bem, não fiz nada.');
    assert.equal(executed.length, 1, 'só a primeira tentativa chegou ao PC');
});

test('shouldEscapeProgramNamesInSpeech', async () => {
    const { skill } = await buildSkill({ agentStatus: () => ({ status: 'ambiguous', choices: ['AT&T <Beta>', 'Outro'] }) });
    const response = await skill.invoke(intentRequest('AbrirAplicativoIntent', { aplicativo: { name: 'aplicativo', value: 'at' } }));
    assert.equal(speechOf(response), 'Encontrei AT&amp;T &lt;Beta&gt; e Outro. Qual deles?');
});

// ---- Claude e Claude Code ----
test('shouldAskClaudeAndConfirmThatAnswerGoesToPc', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: 'ok' });
    const response = await skill.invoke(intentRequest('PerguntarClaudeIntent', { pergunta: { name: 'pergunta', value: 'qual a capital da austrália' } }));
    assert.equal(speechOf(response), 'Perguntei ao Claude. A resposta vai sair no computador.');
    assert.deepEqual(executed, [{ actionId: 'perguntar_claude', params: { pergunta: 'qual a capital da austrália' } }]);
});

test('shouldReadClaudeSummaryOrSayItIsStillThinking', async () => {
    const answer = await buildSkill({ agentStatus: () => ({ status: 'ok', text: 'A capital é Canberra & não Sydney.' }) });
    const read = await answer.skill.invoke(intentRequest('ExecutarRotinaIntent', matchedSlot('rotina', 'a resposta do claude', 'resposta_claude')));
    assert.equal(speechOf(read), 'A capital é Canberra &amp; não Sydney.');
    const thinking = await buildSkill({ agentStatus: () => ({ status: 'pending' }) });
    const wait = await thinking.skill.invoke(intentRequest('ExecutarRotinaIntent', matchedSlot('rotina', 'a resposta do claude', 'resposta_claude')));
    assert.equal(speechOf(wait), 'O Claude ainda está pensando. Peça a resposta de novo daqui a pouco.');
    const none = await buildSkill({ agentStatus: () => ({ status: 'not_found' }) });
    const empty = await none.skill.invoke(intentRequest('ExecutarRotinaIntent', matchedSlot('rotina', 'a resposta do claude', 'resposta_claude')));
    assert.equal(speechOf(empty), 'Ainda não há resposta do Claude.');
});

function pinAgent(correctPin) {
    return (command) => {
        if (command.params.pin === undefined) return { status: 'pin_required' };
        return command.params.pin === correctPin ? { status: 'ok' } : { status: 'pin_required' };
    };
}

test('shouldAskPinThenSendOrderWithDigitsSpokenOneByOne', async () => {
    const { skill, executed, logs } = await buildSkill({ agentStatus: pinAgent('482913') });
    const question = await skill.invoke(intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'rode os testes do projeto' } }));
    assert.equal(speechOf(question), 'Para usar o Claude Code, diga o seu PIN, um número de cada vez.');
    assert.equal(question.sessionAttributes.pendingPin.params.pin, undefined, 'o PIN nunca fica na sessão');
    const wrong = await skill.invoke(followUp(question, 'PinIntent', { pin: { name: 'pin', value: '111111' } }));
    assert.equal(speechOf(wrong), 'PIN incorreto. Diga de novo, um número de cada vez.');
    const right = await skill.invoke(followUp(wrong, 'PinIntent', { pin: { name: 'pin', value: 'quatro oito dois nove um três' } }));
    assert.equal(speechOf(right), 'Enviei para o Claude Code. Quando ele terminar, o computador avisa.');
    assert.deepEqual(executed[2], { actionId: 'claude_code_ordem', params: { ordem: 'rode os testes do projeto', pin: '482913' } });
    assert.ok(!JSON.stringify(logs).includes('482913'), 'PIN nunca no log');
});

test('shouldRepromptWhenPinIsNotUnderstoodAndGiveUpAfterTwoTries', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: pinAgent('482913') });
    let turn = await skill.invoke(intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'x' } }));
    const unclear = 'Não entendi o PIN. Diga um número de cada vez, por exemplo: zero, meia, três.';
    for (const expected of [unclear, unclear, 'Tudo bem, não fiz nada.']) {
        turn = await skill.invoke(followUp(turn, 'PinIntent', { pin: { name: 'pin', value: '12' } }));
        assert.equal(speechOf(turn), expected);
    }
    assert.equal(executed.length, 1);
});

test('shouldSayLockedAfterTooManyWrongPins', async () => {
    const { skill } = await buildSkill({ agentStatus: () => ({ status: 'locked' }) });
    const response = await skill.invoke(intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'x' } }));
    assert.equal(speechOf(response), 'O Claude Code está bloqueado por tentativas erradas. Tente de novo em quinze minutos.');
});

test('shouldRefuseUnknownVoiceWhenVoiceIdIsConfigured', async () => {
    const { hashUserId: hash } = require('../handlers/actionHandler');
    const secrets = { ...SECRETS, allowedPersonIdHashes: [hash('amzn1.ask.person.DONO')] };
    const { skill, broker } = await buildSkill({ secrets, agentStatus: 'ok' });
    const withPerson = (personId) => {
        const request = intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'x' } });
        if (personId) request.context.System.person = { personId };
        return request;
    };
    assert.equal(speechOf(await skill.invoke(withPerson('amzn1.ask.person.VISITA'))), 'Não reconheci a sua voz para usar o Claude Code.');
    assert.equal(speechOf(await skill.invoke(withPerson(undefined))), 'Não reconheci a sua voz para usar o Claude Code.');
    assert.equal(broker.published.length, 0);
    assert.equal(speechOf(await skill.invoke(withPerson('amzn1.ask.person.DONO'))), 'Enviei para o Claude Code. Quando ele terminar, o computador avisa.');
});

test('shouldLogOnlyHashOfUnregisteredVoice', async () => {
    const { skill, logs } = await buildSkill({ agentStatus: 'ok' });
    const request = intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'x' } });
    request.context.System.person = { personId: 'amzn1.ask.person.SEGREDO' };
    await skill.invoke(request);
    const seen = logs.find((entry) => entry.event === 'person_seen');
    assert.match(seen.personHash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(logs).includes('SEGREDO'));
});

test('shouldUnderstandMeiaAsSixAndKeepLeadingZero', async () => {
    const { skill, executed } = await buildSkill({ agentStatus: pinAgent('0631') });
    const question = await skill.invoke(intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'x' } }));
    await skill.invoke(followUp(question, 'PinIntent', { pin: { name: 'pin', value: 'zero, meia, três, um' } }));
    assert.equal(executed[1].params.pin, '0631');
});

test('shouldAskWhichProjectAndResendOrderWithChosenProject', async () => {
    const agent = (command) => (command.params.projeto ? { status: 'ok' } : { status: 'ambiguous', choices: ['Gerador-de-Imagens', 'Gerador-de-Videos'] });
    const { skill, executed } = await buildSkill({ agentStatus: agent });
    const question = await skill.invoke(intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'no projeto gerador crie um teste' } }));
    assert.equal(speechOf(question), 'Encontrei Gerador-de-Imagens e Gerador-de-Videos. Qual deles?');
    const answer = await skill.invoke(followUp(question, 'EscolhaIntent', { escolha: { name: 'escolha', value: 'o segundo' } }));
    assert.equal(speechOf(answer), 'Enviei para o Claude Code. Quando ele terminar, o computador avisa.');
    assert.deepEqual(executed[1].params, { ordem: 'no projeto gerador crie um teste', projeto: 'Gerador-de-Videos' });
});

test('shouldSayProjectNotFound', async () => {
    const { skill } = await buildSkill({ agentStatus: () => ({ status: 'not_found', choices: [] }) });
    const response = await skill.invoke(intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'no projeto banana faça algo' } }));
    assert.equal(speechOf(response), 'Não achei esse projeto do Claude Code.');
});

test('shouldAskContinueOrNewChatAfterThreeHours', async () => {
    const agent = (command) => (command.params.chat ? { status: 'ok' } : { status: 'chat_choice' });
    for (const [intentName, slots, expected] of [
        ['AMAZON.YesIntent', {}, 'continuar'],
        ['AMAZON.NoIntent', {}, 'novo'],
        ['ExecutarRotinaIntent', { rotina: { name: 'rotina', value: 'continuar o anterior' } }, 'continuar'],
        ['EscolhaIntent', { escolha: { name: 'escolha', value: 'começar um novo' } }, 'novo'],
    ]) {
        const { skill: alexa, executed } = await buildSkill({ agentStatus: agent });
        const question = await alexa.invoke(intentRequest('MandarClaudeCodeIntent', { ordem: { name: 'ordem', value: 'rode os testes' } }));
        assert.equal(speechOf(question), 'Faz mais de três horas desde a última ordem. Quer continuar o chat anterior do Claude Code ou começar um novo?');
        const answer = await alexa.invoke(followUp(question, intentName, slots));
        assert.equal(speechOf(answer), 'Enviei para o Claude Code. Quando ele terminar, o computador avisa.', intentName);
        assert.deepEqual(executed[1].params, { ordem: 'rode os testes', chat: expected }, intentName);
    }
});
