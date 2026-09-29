'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSecrets } = require('../../lambda/config/secretsLoader');
const { validateAgentConfig } = require('../src/config/agentConfig');
const { normalizeBrokerUrl, isValidSkillId, generateIdentity, buildConfigFiles } = require('../src/install/secretsFactory');
const { coreTaskXml, desktopTaskXml } = require('../src/install/windowsTasks');

const USER_SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const PROGRAM = Object.freeze({
    nodePath: 'C:\\Program Files\\OMonstro\\node.exe',
    appPath: 'C:\\Program Files\\OMonstro\\o-monstro.cjs',
});
const ANSWERS = {
    brokerUrl: 'mqtts://abc123.s1.eu.hivemq.cloud:8883',
    pcUser: 'pc-o-monstro',
    pcPassword: 'senha-pc',
    alexaUser: 'alexa-o-monstro',
    alexaPassword: 'senha-alexa',
    skillId: 'amzn1.ask.skill.12345678-90ab-cdef-1234-567890abcdef',
};

test('shouldNormalizeBrokerAddressToTlsUrl', () => {
    assert.equal(normalizeBrokerUrl('abc123.s1.eu.hivemq.cloud'), 'mqtts://abc123.s1.eu.hivemq.cloud:8883');
    assert.equal(normalizeBrokerUrl(' mqtts://ABC.s1.eu.hivemq.cloud:8883/ '), 'mqtts://abc.s1.eu.hivemq.cloud:8883');
    for (const bad of ['', 'localhost', 'abc.cloud:porta', 'http://abc.cloud', 'abc.cloud:8883:1', 'a b.cloud']) {
        assert.equal(normalizeBrokerUrl(bad), undefined, bad);
    }
});

test('shouldValidateSkillIdFormat', () => {
    assert.equal(isValidSkillId(ANSWERS.skillId), true);
    assert.equal(isValidSkillId('amzn1.ask.skill.curto'), false);
});

test('shouldGenerateUniqueStrongIdentity', () => {
    const first = generateIdentity();
    const second = generateIdentity();
    assert.notEqual(first.hmacSecret, second.hmacSecret);
    assert.notEqual(first.deviceId, second.deviceId);
    assert.ok(first.hmacSecret.length >= 43);
});

test('shouldProduceConfigsAcceptedByAgentAndSkillWithSameSharedSecret', () => {
    const { agentConfig, alexaSecrets } = buildConfigFiles(generateIdentity(), ANSWERS);
    const agent = validateAgentConfig(agentConfig);
    const skill = validateSecrets(alexaSecrets);
    assert.equal(agent.hmacSecret, skill.hmacSecret);
    assert.equal(agent.deviceId, skill.deviceId);
    assert.equal(agent.mqtt.username, 'pc-o-monstro');
    assert.equal(skill.mqtt.username, 'alexa-o-monstro');
    assert.ok(!JSON.stringify(alexaSecrets).includes('senha-pc'), 'senha do PC não vai para a nuvem');
    assert.ok(!('pipeSecret' in alexaSecrets));
});

test('shouldBuildBootTaskWithoutStoredPasswordAndWithRestart', () => {
    const xml = coreTaskXml({ userSid: USER_SID, ...PROGRAM });
    assert.match(xml, /<BootTrigger>/);
    assert.match(xml, /<LogonType>S4U<\/LogonType>/);
    assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(xml, /<RestartOnFailure>/);
    assert.match(xml, /<Command>C:\\Program Files\\OMonstro\\node\.exe<\/Command>/);
    assert.match(xml, /<Arguments>&quot;C:\\Program Files\\OMonstro\\o-monstro\.cjs&quot; --nucleo<\/Arguments>/);
});

test('shouldBuildLogonTaskForInteractiveSession', () => {
    const xml = desktopTaskXml({ userSid: USER_SID, ...PROGRAM });
    assert.match(xml, new RegExp(`<LogonTrigger><Enabled>true</Enabled><UserId>${USER_SID}</UserId>`));
    assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
    assert.match(xml, /o-monstro\.cjs&quot; --desktop<\/Arguments>/);
});

test('shouldEscapeExecutablePathInTaskXml', () => {
    const xml = coreTaskXml({ userSid: USER_SID, nodePath: 'C:\\A&B\\<x>.exe', appPath: PROGRAM.appPath });
    assert.match(xml, /C:\\A&amp;B\\&lt;x&gt;\.exe/);
});

test('shouldRejectAppPathThatCouldBreakArgumentQuoting', () => {
    assert.throws(() => coreTaskXml({ userSid: USER_SID, ...PROGRAM, appPath: 'C:\\x" --desinstalar "' }), /inválido/);
});

test('shouldRejectInvalidUserSid', () => {
    assert.throws(() => coreTaskXml({ userSid: 'S-1-5-18', ...PROGRAM }), /SID/);
    assert.throws(() => desktopTaskXml({ userSid: '</UserId><x>', ...PROGRAM }), /SID/);
});
