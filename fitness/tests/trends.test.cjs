const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "trends.js"), "utf8");
const sectionNames = [
  "exercise-trend-section", "measurement-trend-section",
  "all-exercises-section", "all-measurements-section"
];

function createEnvironment(options = {}) {
  const storage = options.storage || new Map();
  const errors = [];
  const elements = new Map();
  const createElement = () => ({
    open: true,
    hidden: true,
    textContent: "",
    events: {},
    addEventListener(name, callback) {
      this.events[name] = callback;
    }
  });
  const sections = sectionNames.map(id => {
    const section = { ...createElement(), id };
    elements.set(`#${id}`, section);

    return section;
  });
  const querySelector = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, createElement());
    }

    return elements.get(selector);
  };

  runInNewContext(source, {
    window: {},
    document: {
      querySelector,
      querySelectorAll: () => sections,
      addEventListener() {}
    },
    WorkoutForms: {},
    WorkoutAuth: { init() {} },
    console: { error: (...argumentsToLog) => errors.push(argumentsToLog) },
    localStorage: {
      getItem(key) {
        if (options.failRead) {
          throw new Error("Storage blocked");
        }

        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (options.failWrite) {
          throw new Error("Storage full");
        }

        storage.set(key, value);
      }
    }
  });

  return { sections, storage, errors, status: querySelector("#section-state-status") };
}

test("sections default to expanded and initialization toggles do not overwrite storage", () => {
  const environment = createEnvironment();

  for (const section of environment.sections) {
    assert.equal(section.open, true);
    section.events.toggle();
  }

  assert.equal(environment.storage.size, 0);
});

test("each section remembers both collapsed and expanded states across reloads", () => {
  const environment = createEnvironment();

  for (const section of environment.sections) {
    section.open = false;
    section.events.toggle();
  }

  const reloaded = createEnvironment({ storage: environment.storage });
  assert.ok(reloaded.sections.every(section => !section.open));
  reloaded.sections[0].open = true;
  reloaded.sections[0].events.toggle();
  const restored = createEnvironment({ storage: environment.storage });
  assert.equal(restored.sections[0].open, true);
  assert.ok(restored.sections.slice(1).every(section => !section.open));
});

test("storage read failures are reported without disabling section controls", () => {
  const environment = createEnvironment({ failRead: true });
  assert.equal(environment.status.hidden, false);
  assert.match(environment.status.textContent, /could not be read/);
  assert.equal(environment.errors.length, 4);
  environment.sections[0].open = false;
  environment.sections[0].events.toggle();
  assert.equal(environment.storage.get(`workout.trends.section.${sectionNames[0]}`), "false");
});

test("storage write failures are reported while the section remains collapsed", () => {
  const environment = createEnvironment({ failWrite: true });
  environment.sections[0].open = false;
  environment.sections[0].events.toggle();
  assert.equal(environment.sections[0].open, false);
  assert.equal(environment.status.hidden, false);
  assert.match(environment.status.textContent, /could not be saved/);
  assert.equal(environment.errors.length, 1);
});

test("invalid saved states are reported and leave sections expanded", () => {
  const storage = new Map([[`workout.trends.section.${sectionNames[0]}`, "invalid"]]);
  const environment = createEnvironment({ storage });
  assert.equal(environment.sections[0].open, true);
  assert.equal(environment.status.hidden, false);
  assert.equal(environment.errors.length, 1);
});
