// Shared helpers for the regression tests. Not a test file: `node --test` only runs *.test.cjs.
const settle = () => new Promise(resolve => setImmediate(resolve));

module.exports = { settle };
