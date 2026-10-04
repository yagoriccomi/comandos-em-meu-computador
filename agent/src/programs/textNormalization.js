'use strict';
/* Normalização de nomes para comparar o que a Alexa ouviu com a lista de programas. */

/** "Epic Games®  Launcher!" → "epic games launcher" (sem acentos, minúsculas, só letras/dígitos/espaço). */
function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/\p{Mn}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** "pp ssp p" → "ppsspp": a Alexa às vezes separa as letras de siglas. */
function compactText(value) {
    return normalizeText(value).replace(/ /g, '');
}

/** Distância de Damerau-Levenshtein (com troca de letras vizinhas), para tolerar pequenos erros. */
function editDistance(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const distance = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (__, col) => {
        if (row === 0) return col;
        return col === 0 ? row : 0;
    }));
    for (let row = 1; row < rows; row += 1) {
        for (let col = 1; col < cols; col += 1) {
            const cost = a[row - 1] === b[col - 1] ? 0 : 1;
            distance[row][col] = Math.min(distance[row - 1][col] + 1, distance[row][col - 1] + 1, distance[row - 1][col - 1] + cost);
            if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
                distance[row][col] = Math.min(distance[row][col], distance[row - 2][col - 2] + 1);
            }
        }
    }
    return distance[rows - 1][cols - 1];
}

function similarity(a, b) {
    const longest = Math.max(a.length, b.length);
    return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

module.exports = { normalizeText, compactText, editDistance, similarity };
