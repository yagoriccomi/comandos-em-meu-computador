'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSecretsLoader, validateSecrets, SecretsError, SECRETS_OBJECT_KEY } = require('../config/secretsLoader');

const VALID_SECRETS = {
    skillId: 'amzn1.ask.skill.00000000-0000-0000-0000-000000000000',
    deviceId: 'pc-teste-1234',
    hmacSecret: 'x'.repeat(43),
    mqtt: { url: 'mqtts://exemplo.s1.eu.hivemq.cloud:8883', username: 'alexa-o-monstro', password: 'senha-de-teste' },
};

function assertSecretsError(code, fn) {
    assert.throws(fn, (error) => error instanceof SecretsError && error.code === code);
}

test('shouldLoadAndCacheSecretsFromS3', async () => {
    let reads = 0;
    const loadSecrets = createSecretsLoader({
        bucket: 'bucket-da-skill',
        readObject: async (bucket, key) => {
            reads += 1;
            assert.deepEqual([bucket, key], ['bucket-da-skill', SECRETS_OBJECT_KEY]);
            return JSON.stringify(VALID_SECRETS);
        },
    });
    const first = await loadSecrets();
    await loadSecrets();
    assert.equal(first.deviceId, 'pc-teste-1234');
    assert.equal(reads, 1);
});

test('shouldRetryAfterFailedRead', async () => {
    let attempts = 0;
    const loadSecrets = createSecretsLoader({
        bucket: 'bucket-da-skill',
        readObject: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('S3 fora do ar');
            return JSON.stringify(VALID_SECRETS);
        },
    });
    await assert.rejects(loadSecrets());
    assert.equal((await loadSecrets()).deviceId, 'pc-teste-1234');
});

test('shouldFailWithoutBucket', async () => {
    const loadSecrets = createSecretsLoader({ bucket: undefined, readObject: async () => '{}' });
    await assert.rejects(loadSecrets(), (error) => error.code === 'missing_bucket');
});

test('shouldFailWhenFileIsNotJson', async () => {
    const loadSecrets = createSecretsLoader({ bucket: 'b', readObject: async () => 'não é json' });
    await assert.rejects(loadSecrets(), (error) => error.code === 'secrets_not_json');
});

test('shouldRequireTlsBrokerUrl', () => {
    assertSecretsError('invalid_mqtt_url', () =>
        validateSecrets({ ...VALID_SECRETS, mqtt: { ...VALID_SECRETS.mqtt, url: 'mqtt://sem-tls:1883' } }));
});

test('shouldRequireLongHmacSecret', () => {
    assertSecretsError('invalid_hmac_secret', () => validateSecrets({ ...VALID_SECRETS, hmacSecret: 'curta' }));
});

test('shouldRequireAlexaSkillId', () => {
    assertSecretsError('invalid_skill_id', () => validateSecrets({ ...VALID_SECRETS, skillId: 'qualquer' }));
});

test('shouldAcceptOptionalUserHashAllowList', () => {
    const secrets = validateSecrets({ ...VALID_SECRETS, allowedUserIdHashes: ['a'.repeat(64)] });
    assert.deepEqual([...secrets.allowedUserIdHashes], ['a'.repeat(64)]);
    assertSecretsError('invalid_user_hashes', () => validateSecrets({ ...VALID_SECRETS, allowedUserIdHashes: ['amzn1.ask.account.X'] }));
});

test('shouldReadSecretsWithRuntimeAwsSdkV2WhenAvailable', async () => {
    const { createS3ObjectReader } = require('../config/secretsLoader');
    const calls = [];
    const fakeV2 = {
        S3: function S3(options) {
            calls.push({ options });
            this.getObject = (params) => ({ promise: async () => { calls.push({ params }); return { Body: Buffer.from('{"ok":true}') }; } });
        },
    };
    const readObject = createS3ObjectReader({ region: 'us-east-1', requireModule: (name) => {
        if (name === 'aws-sdk') return fakeV2;
        throw new Error('não deveria carregar ' + name);
    } });
    assert.equal(await readObject('bucket', 'config/secrets.json'), '{"ok":true}');
    assert.deepEqual(calls[1].params, { Bucket: 'bucket', Key: 'config/secrets.json' });
});

test('shouldFallBackToRuntimeAwsSdkV3WhenV2IsAbsent', async () => {
    const { createS3ObjectReader } = require('../config/secretsLoader');
    function GetObjectCommand(input) { this.input = input; }
    function S3Client() { this.send = async (command) => ({ Body: { transformToString: async () => JSON.stringify(command.input) } }); }
    const readObject = createS3ObjectReader({ region: 'us-east-1', requireModule: (name) => {
        if (name === 'aws-sdk') throw Object.assign(new Error('ausente'), { code: 'MODULE_NOT_FOUND' });
        return { S3Client, GetObjectCommand };
    } });
    assert.equal(await readObject('b', 'k'), '{"Bucket":"b","Key":"k"}');
});
