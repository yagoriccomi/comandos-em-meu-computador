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
    VERB_PATTERN: require('../../lambda/domain/catalog').VERB_PATTERN,
};
