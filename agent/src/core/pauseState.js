'use strict';
/* Estado "pausado" do agente, persistido para sobreviver a reinícios. */
const fs = require('fs');

function createPauseState(filePath) {
    let paused = false;
    try {
        paused = JSON.parse(fs.readFileSync(filePath, 'utf8')).paused === true;
    } catch (error) {
        paused = false;
    }
    return {
        isPaused: () => paused,
        setPaused(value) {
            paused = value === true;
            try {
                fs.writeFileSync(filePath, JSON.stringify({ paused }));
            } catch (error) {
                // Sem persistência o estado ainda vale até o próximo reinício.
            }
        },
    };
}

module.exports = { createPauseState };
