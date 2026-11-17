'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { steamGameProcesses } = require('../src/programs/steamProcesses');

test('shouldListGameExesFromSteamManifest', () => {
    const library = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
    const game = path.join(library, 'steamapps', 'common', 'Deadlock', 'game', 'bin');
    fs.mkdirSync(game, { recursive: true });
    fs.writeFileSync(path.join(library, 'steamapps', 'appmanifest_1422450.acf'), '"AppState"\n{\n\t"installdir"\t\t"Deadlock"\n}');
    fs.writeFileSync(path.join(game, 'deadlock.exe'), '');
    fs.writeFileSync(path.join(game, 'crashreporter.exe'), '');
    assert.deepEqual(steamGameProcesses('steam://rungameid/1422450', [library]), [{ folder: game, exe: 'deadlock.exe' }]);
    assert.deepEqual(steamGameProcesses('steam://rungameid/999', [library]), []);
    assert.deepEqual(steamGameProcesses('Microsoft.Edge', [library]), []);
});
