const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "trends.js"), "utf8");
const utilitiesSource = readFileSync(path.join(__dirname, "..", "utilities.js"), "utf8");
const formsSource = readFileSync(path.join(__dirname, "..", "google-forms.js"), "utf8");
const { settle } = require("./helpers.cjs");
const sectionNames = [
  "exercise-trend-section", "measurement-trend-section",
  "all-exercises-section", "all-measurements-section"
];

function createEnvironment(options = {}) {
  const storage = options.storage || new Map();
  const errors = [];
  const readCalls = [];
  let handlers;
  let clearCount = 0;
  const elements = new Map();
  const createElement = () => ({
    open: true,
    hidden: true,
    textContent: "",
    value: "",
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
  const window = { WORKOUT_CONFIG: options.configuration || {} };
  const formsWindow = {};
  runInNewContext(formsSource, { window: formsWindow });
  const forms = {
    ...formsWindow.WorkoutForms,
    async readForm(...argumentsToRead) {
      readCalls.push(argumentsToRead);

      return options.readForm(...argumentsToRead);
    }
  };
  const authentication = {
    user: null,
    init(pageHandlers) { handlers = pageHandlers; },
    clearCachedToken() { clearCount += 1; }
  };
  runInNewContext(utilitiesSource, { window });

  runInNewContext(source, {
    window,
    document: {
      querySelector,
      querySelectorAll: () => sections,
      addEventListener() {}
    },
    WorkoutForms: forms,
    WorkoutAuth: authentication,
    WorkoutSettings: { units: "metric", weightUnit: "kg", weightFromKg: value => value },
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

  return {
    sections, storage, errors, readCalls, forms, status: querySelector("#section-state-status"),
    element: querySelector,
    signIn(email = "current@example.com") {
      authentication.user = { email };
      handlers.onSignIn();
    },
    signOut() {
      authentication.user = null;
      handlers.onSignOut();
    },
    reload: () => querySelector("#load-data").events.click(),
    get clearCount() { return clearCount; }
  };
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

const CONFIGURATION = {
  form: { formId: "workouts" },
  measurementsForm: { formId: "measurements" }
};

function formResult(rows) {
  const fieldNames = [...new Set(rows.flatMap(row => Object.keys(row).filter(field => field !== "submitted")))];

  return {
    questionMap: new Map(fieldNames.map(field => [field, field])),
    responses: rows.map(row => ({
      lastSubmittedTime: row.submitted,
      answers: Object.fromEntries(fieldNames.filter(field => row[field] !== undefined).map(field => [
        field, { textAnswers: { answers: [{ value: String(row[field]) }] } }
      ]))
    }))
  };
}

test("Trends uses the shared read and decode pipeline for workouts and latest daily measurements", async () => {
  const environment = createEnvironment({
    configuration: CONFIGURATION,
    readForm: async form => formResult(form.formId === "workouts" ? [{
      email: "current@example.com", exercise: "Row", sessionId: "session", date: "2026-10-28", reps: 12
    }] : [
      { email: "current@example.com", date: "2026-10-28", weightKg: 80, submitted: "2026-10-28T08:00:00Z" },
      { email: "current@example.com", date: "2026-10-28", weightKg: 81, submitted: "2026-10-28T09:00:00Z" }
    ])
  });
  environment.signIn();
  await settle();
  assert.equal(environment.readCalls.length, 2);
  assert.deepEqual([...environment.readCalls[0][2].requiredFields], ["exercise"]);
  assert.deepEqual([...environment.readCalls[1][2].requiredFields], ["date"]);
  assert.ok(environment.readCalls.every(call => call[2].retryUnauthorized));
  assert.match(environment.element("#trends-status").textContent, /Showing 1 set and 1 measurement entry/);
  assert.match(environment.element("#measurement-table").innerHTML, /81 kg/);
  assert.match(environment.element("#measurement-chart").innerHTML,
    /<svg [^>]*role="img" aria-label="[^"]*1 data point on 2026-10-28\. Latest 81, lowest 81, highest 81\./);
  assert.equal(environment.element("#results").hidden, false);
  assert.equal(environment.element("#load-data").disabled, false);
});

test("measurement read failures remain separate from successful workout data", async () => {
  let forms;
  const environment = createEnvironment({
    configuration: CONFIGURATION,
    readForm: async form => {
      if (form.formId === "measurements") {
        throw new forms.RequestError(403, { error: { message: "Denied" } });
      }

      return formResult([{ email: "current@example.com", exercise: "Row", date: "2026-10-28", reps: 12 }]);
    }
  });
  forms = environment.forms;
  environment.signIn();
  await settle();
  assert.match(environment.element("#trends-status").textContent, /Showing 1 set/);
  assert.match(environment.element("#measurement-trends-status").textContent, /edit access/);
  assert.equal(environment.element("#results").hidden, false);
});

test("workout permission failures still show setup help without discarding the shared token", async () => {
  let forms;
  const environment = createEnvironment({
    configuration: CONFIGURATION,
    readForm: async () => { throw new forms.RequestError(403, { error: { message: "Denied" } }); }
  });
  forms = environment.forms;
  environment.signIn();
  await settle();
  assert.equal(environment.element("#fork-help").hidden, false);
  assert.match(environment.element("#fork-reason").textContent, /doesn't have access/);
  assert.equal(environment.clearCount, 0);
});

test("automatic and interactive popup failures retain their page-specific guidance", async () => {
  const environment = createEnvironment({
    configuration: CONFIGURATION,
    readForm: async () => { throw Object.assign(new Error("Blocked"), { code: "popup_failed_to_open" }); }
  });
  environment.signIn();
  await settle();
  assert.match(environment.element("#trends-status").textContent, /Press Load my data to give read access/);
  await environment.reload();
  assert.match(environment.element("#trends-status").textContent, /Allow pop-ups/);
});

test("a read completing after sign-out cannot repaint results or report a stale error", async () => {
  for (const failRead of [false, true]) {
    let finishRead;
    let failPendingRead;
    const environment = createEnvironment({
      configuration: CONFIGURATION,
      readForm: () => new Promise((resolve, reject) => {
        finishRead = resolve;
        failPendingRead = reject;
      })
    });
    environment.signIn();
    environment.signOut();

    if (failRead) {
      failPendingRead(new Error("Stale failure"));
    } else {
      finishRead(formResult([]));
    }

    await settle();
    assert.equal(environment.element("#trends-view").hidden, true);
    assert.equal(environment.element("#results").hidden, true);
    assert.equal(environment.element("#trends-status").textContent, "");
    assert.equal(environment.clearCount, 0);
  }
});

test("switching accounts starts a new read and ignores the earlier account's completion", async () => {
  let finishFirstRead;
  const environment = createEnvironment({
    configuration: CONFIGURATION,
    readForm: () => {
      if (!finishFirstRead) {
        return new Promise(resolve => { finishFirstRead = resolve; });
      }

      return Promise.resolve(formResult([]));
    }
  });
  environment.signIn();
  environment.signIn("other@example.com");
  await settle();
  assert.equal(environment.readCalls.length, 3);
  const currentStatus = environment.element("#trends-status").textContent;
  finishFirstRead(formResult([{ email: "current@example.com", exercise: "Stale", reps: 50 }]));
  await settle();
  assert.equal(environment.element("#trends-status").textContent, currentStatus);
  assert.doesNotMatch(environment.element("#user-select").innerHTML, /current@example.com/);
});
