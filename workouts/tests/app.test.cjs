const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const SOURCE = readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));

function createEnvironment(options = {}) {
  const elements = new Map();
  let handlers;
  let loadCount = 0;
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: "", events: {},
        addEventListener(name, callback) { this.events[name] = callback; }
      });
    }

    return elements.get(selector);
  };
  const authentication = {
    init(callbacks) { handlers = callbacks; }
  };
  const routines = {
    isConfigured: () => options.configured !== false,
    clearCachedToken() {},
    load() {
      loadCount += 1;

      return options.load ? options.load() : Promise.resolve({ routines: new Map(), warnings: [] });
    }
  };
  const window = {
    WORKOUT_CONFIG: {},
    addEventListener() {},
    WorkoutAuth: authentication,
    WorkoutRoutines: routines
  };

  // Wire the real page events and auth callbacks without rendering exercise templates.
  const source = SOURCE.replace(/\r?\n  boot\(\);\r?\n\}\)\(\);\s*$/, `
  wireEvents();
  WorkoutAuth.init({ onSignIn: showTracker, onSignOut: hideTracker });
})();`);
  assert.notEqual(source, SOURCE);
  runInNewContext(source, {
    window, WorkoutAuth: authentication, WorkoutRoutines: routines,
    document: {
      querySelector: element,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    localStorage: { getItem: () => null }
  });

  return {
    signIn: () => handlers.onSignIn({ email: "current@example.com" }),
    signOut: () => handlers.onSignOut(),
    refresh: () => element("#refresh-routines").events.click(),
    status: () => element("#routine-status").textContent,
    loadCount: () => loadCount
  };
}

test("automatically loads once and does not retry an empty catalog on sign-in", async () => {
  const environment = createEnvironment();
  assert.equal(environment.loadCount(), 0);
  environment.signIn();
  await settle();
  assert.equal(environment.loadCount(), 1);
  assert.match(environment.status(), /Loaded 0 shared routines/);
  environment.signIn();
  environment.signOut();
  environment.signIn();
  await settle();
  assert.equal(environment.loadCount(), 1);
});

test("does not automatically reload an already loaded routine catalog", async () => {
  const environment = createEnvironment({
    load: async () => ({
      routines: new Map([["Upper body", { name: "Upper body", exercises: [] }]]),
      warnings: []
    })
  });
  environment.signIn();
  await settle();
  environment.signIn();
  await settle();
  assert.equal(environment.loadCount(), 1);
  assert.match(environment.status(), /Loaded 1 shared routine/);
});

test("repeated sign-in callbacks do not duplicate an in-flight automatic load", async () => {
  let finishLoad;
  const environment = createEnvironment({
    load: () => new Promise(resolve => { finishLoad = resolve; })
  });
  environment.signIn();
  environment.signIn();
  assert.equal(environment.loadCount(), 1);
  finishLoad({ routines: new Map(), warnings: [] });
  await settle();
  environment.signIn();
  assert.equal(environment.loadCount(), 1);
});

test("a failed automatic load shows the error and is not retried automatically", async () => {
  const environment = createEnvironment({
    load: async () => { throw new Error("Form unavailable"); }
  });
  environment.signIn();
  await settle();
  assert.equal(environment.status(), "Form unavailable");
  environment.signOut();
  environment.signIn();
  await settle();
  assert.equal(environment.loadCount(), 1);
});

test("manual refresh remains available after an empty automatic load", async () => {
  const environment = createEnvironment();
  environment.signIn();
  await settle();
  await environment.refresh();
  await environment.refresh();
  assert.equal(environment.loadCount(), 3);
});

test("a fresh page lifetime allows one new automatic attempt", async () => {
  for (let pageLoad = 0; pageLoad < 2; pageLoad += 1) {
    const environment = createEnvironment();
    environment.signIn();
    await settle();
    environment.signIn();
    assert.equal(environment.loadCount(), 1);
  }
});

test("does not request routines when the Google Form is not configured", async () => {
  const environment = createEnvironment({ configured: false });
  environment.signIn();
  await settle();
  assert.equal(environment.loadCount(), 0);
  assert.match(environment.status(), /Shared routines aren't set up/);
});
