
/**
 * const ctx = require.context('.', true, /\.ANY_EXTENSION$/);
 * returns an array of entries [filename, module]
 * @param {Function} ctx
 * @returns {Array} entries
 */
export const getModuleEntries = ctx => ctx.keys().map(filename => ([filename, ctx(filename)]));