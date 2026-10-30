// Shared helpers for the regression tests. Not a test file: `node --test` only runs *.test.cjs.
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { runInNewContext } = require("node:vm");

const settle = () => new Promise(resolve => setImmediate(resolve));
const readSource = filename => readFileSync(path.join(__dirname, "..", filename), "utf8");

// A stand-in for any DOM object: every property read or call returns another stand-in.
function permissive() {
  return new Proxy(function stub() {}, {
    get: (target, key) => (key === Symbol.toPrimitive ? () => "" : permissive()),
    apply: () => permissive(),
    construct: () => permissive(),
    set: () => true
  });
}

// Runs a page script (an IIFE) and returns some of its private functions, so pure logic can be tested
// without exporting it from production code. The accessors are installed first and read lazily, so
// declarations further down the file are available; errors thrown by the page's own start-up code
// against the permissive DOM are ignored.
function loadInternals(filename, names, globals = {}) {
  const source = readSource(filename);
  const accessors = names.map(name => `get ${name}() { return ${name}; }`).join(", ");
  const instrumented = source.replace(/(\(\s*\)\s*=>\s*\{\s*["']use strict["'];)/, `$1\n  globalThis.__internals = { ${accessors} };`);

  if (instrumented === source) {
    throw new Error(`${filename}: could not find the "use strict" IIFE header to instrument`);
  }

  const window = globals.window || {};
  const context = {
    window,
    document: permissive(),
    localStorage: permissive(),
    sessionStorage: permissive(),
    WorkoutAuth: permissive(),
    WorkoutForms: permissive(),
    WorkoutSettings: permissive(),
    WorkoutRoutines: permissive(),
    WorkoutPlans: permissive(),
    WorkoutSubmissionStatus: permissive(),
    WorkoutUtilities: window.WorkoutUtilities,
    console: { log() {}, warn() {}, error: (...a) => { if (process.env.DEBUG_TESTS) { console.error(...a); } } },
    ...globals
  };

  try {
    runInNewContext(instrumented, context);
  } catch {
    // Start-up code needs a real page; the functions under test do not.
  }

  return new Proxy({}, { get: (target, name) => context.__internals[name] });
}

// Loads utilities.js and returns the window object carrying WorkoutUtilities.
function loadUtilities() {
  const window = {};
  runInNewContext(readSource("utilities.js"), { window });

  return window;
}

module.exports = { settle, readSource, permissive, loadInternals, loadUtilities };
