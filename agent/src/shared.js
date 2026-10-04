'use strict';
/*
 * Código compartilhado com a skill. A Lambda só empacota lambda/, então o agente importa de lá
 * (o esbuild embute no .exe) — uma única fonte da verdade para protocolo e catálogo público.
 */
module.exports = {
    protocol: require('../../lambda/protocol/message'),
    publicCatalog: require('../../lambda/domain/catalog').catalog,
    buildCatalog: require('../../lambda/domain/catalog').buildCatalog,
    ParamType: require('../../lambda/domain/catalog').ParamType,
    PROGRAM_ID_PATTERN: require('../../lambda/domain/catalog').PROGRAM_ID_PATTERN,
    // Modelo de voz versionado: base para gerar o modelo com a lista privada de programas.
    baseVoiceModel: require('../../interactionModels/custom/pt-BR.json'),
};
