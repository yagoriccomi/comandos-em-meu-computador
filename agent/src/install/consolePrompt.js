'use strict';
/*
 * Perguntas no console do instalador.
 * - Texto comum: readline com a pergunta como prompt do próprio readline (o terminal do Windows redesenha
 *   a linha a cada tecla; prompt escrito "por fora" era apagado e a pergunta sumia da tela).
 * - Senha: leitura em modo raw, sem readline ativo, mostrando "*" por caractere. Assim nada do que é
 *   digitado ecoa na tela nem cai em outra pergunta.
 */
const readline = require('readline');

const Key = Object.freeze({
    ENTER: '\r',
    NEWLINE: '\n',
    CTRL_C: '\u0003',
    BACKSPACE: '\u0008',
    DELETE: '\u007f',
});
const EXIT_CODE_INTERRUPTED = 130;
const FIRST_PRINTABLE = ' ';

function createConsolePrompt({ input = process.stdin, output = process.stdout, onInterrupt = () => process.exit(EXIT_CODE_INTERRUPTED) } = {}) {
    function askVisible(promptText) {
        return new Promise((resolve) => {
            const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
            rl.question(promptText, (answer) => {
                rl.close();
                if (!input.isTTY) output.write('\n'); // sem terminal não há eco do Enter
                resolve(answer);
            });
        });
    }

    function askHidden(promptText) {
        return new Promise((resolve) => {
            output.write(promptText);
            const wasRaw = Boolean(input.isRaw);
            if (input.setRawMode) input.setRawMode(true);
            input.resume();
            let value = '';

            const cleanup = () => {
                input.off('data', onData);
                if (input.setRawMode) input.setRawMode(wasRaw);
                input.pause();
                output.write('\n');
            };

            function onData(chunk) {
                for (const character of String(chunk)) {
                    if (character === Key.ENTER || character === Key.NEWLINE) {
                        cleanup();
                        resolve(value);
                        return;
                    }
                    if (character === Key.CTRL_C) {
                        cleanup();
                        onInterrupt();
                        return;
                    }
                    if (character === Key.BACKSPACE || character === Key.DELETE) {
                        if (value.length > 0) {
                            value = value.slice(0, -1);
                            output.write('\b \b');
                        }
                    } else if (character >= FIRST_PRINTABLE) {
                        value += character;
                        output.write('*');
                    }
                }
            }

            input.on('data', onData);
        });
    }

    async function ask(question, { defaultValue, hidden = false } = {}) {
        const suffix = defaultValue ? ` [${defaultValue}]` : '';
        const promptText = `${question}${suffix}: `;
        const answer = hidden ? await askHidden(promptText) : await askVisible(promptText);
        // Senha não é aparada: espaços podem fazer parte dela.
        const value = hidden ? answer : answer.trim();
        return value || defaultValue || '';
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
        close: () => {},
    };
}

module.exports = { createConsolePrompt };
