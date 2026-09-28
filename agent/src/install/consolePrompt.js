'use strict';
/* Perguntas no console do instalador (com entrada oculta para senhas). */
const readline = require('readline');

function createConsolePrompt({ input = process.stdin, output = process.stdout } = {}) {
    const rl = readline.createInterface({ input, output, terminal: true });
    let muted = false;
    const originalWrite = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (text) => {
        if (!muted) originalWrite(text);
    };

    function ask(question, { defaultValue, hidden = false } = {}) {
        const suffix = defaultValue ? ` [${defaultValue}]` : '';
        return new Promise((resolve) => {
            output.write(`${question}${suffix}: `);
            muted = hidden;
            rl.question('', (answer) => {
                if (hidden) output.write('\n');
                muted = false;
                const value = answer.trim();
                resolve(value || defaultValue || '');
            });
        });
    }

    async function askUntilValid(question, isValid, errorMessage, options) {
        for (;;) {
            const answer = await ask(question, options);
            if (isValid(answer)) return answer;
            output.write(`  ${errorMessage}\n`);
        }
    }

    async function confirm(question, defaultYes = true) {
        const answer = (await ask(`${question} (${defaultYes ? 'S/n' : 's/N'})`)).toLowerCase();
        if (!answer) return defaultYes;
        return answer.startsWith('s');
    }

    return {
        ask,
        askUntilValid,
        confirm,
        say: (text = '') => output.write(`${text}\n`),
        close: () => rl.close(),
    };
}

module.exports = { createConsolePrompt };
