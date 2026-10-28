const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { randomUUID } = require("node:crypto");

const FIELD_NAMES = [
  "email", "measurementId", "date", "neckCm", "bicepLCm", "bicepRCm", "forearmLCm",
  "forearmRCm", "shouldersCm", "chestCm", "waistCm", "bellyCm", "buttCm", "thighLCm",
  "thighRCm", "calfLCm", "calfRCm", "weightKg", "sleepHours", "waterLitres", "energy", "mood"
];
const CONFIGURATION = {
  actionUrl: "https://docs.google.com/forms/d/e/measurements/formResponse",
  fields: Object.fromEntries(FIELD_NAMES.map((field, index) => [field, `entry.${index + 1}`]))
};
const storageKey = email => "fitness.measurements." + encodeURIComponent(email.toLowerCase());
const settle = () => new Promise(resolve => setImmediate(resolve));

function createEnvironment(options = {}) {
  const elements = new Map();
  const events = {};
  const requests = [];
  const storage = options.storage || new Map();
  const errors = [];
  const controls = { failNetwork: false, failWrite: false };
  let handlers;
  let units = options.units || "metric";

  function createElement() {
    const element = {
      value: "", dataset: {}, children: [], events: {}, textContent: "", hidden: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(name, callback) { this.events[name] = callback; },
      focus() { this.focused = true; },
      scrollIntoView() {},
      reportValidity() { return true; }
    };
    Object.defineProperty(element, "id", {
      set(value) { elements.set(`#${value}`, element); }
    });

    return element;
  }

  [
    "measurement-fields", "measurement-date", "measurement-form", "measurement-status",
    "measurement-history", "measurement-queue", "measurement-queue-text", "submit-measurements",
    "retry-measurements", "clear-measurements", "undo-clear-measurements", "measurements-view", "login-view", "setup-warning"
  ].forEach(name => elements.set(`#${name}`, createElement()));
  const window = {
    WORKOUT_CONFIG: { measurementsForm: options.configuration || CONFIGURATION },
    WorkoutSettings: {
      get units() { return units; },
      get weightUnit() { return units === "imperial" ? "lb" : "kg"; },
      weightToKg: (value, system = units) => system === "imperial" ? value * 0.45359237 : value,
      weightFromKg: (value, system = units) => system === "imperial" ? value / 0.45359237 : value
    },
    WorkoutAuth: {
      user: null,
      init(pageHandlers) { handlers = pageHandlers; }
    },
    addEventListener: (name, callback) => { events[name] = callback; }
  };
  const context = {
    window, URLSearchParams, AbortController, setTimeout, clearTimeout, crypto: { randomUUID },
    console: { error: (...messages) => errors.push(messages) },
    document: {
      createElement,
      querySelector: selector => elements.get(selector),
      addEventListener: (name, callback) => { events[name] = callback; }
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (controls.failWrite) {
          throw new Error("Storage unavailable");
        }

        storage.set(key, value);
      }
    },
    fetch: async (url, request) => {
      requests.push({ url, request });

      if (controls.failNetwork) {
        throw new Error("Network unavailable");
      }

      if (controls.requestBarrier) {
        await controls.requestBarrier;
      }

      return { type: "opaque" };
    }
  };
  for (const filename of ["utilities.js", "google-forms.js", "submission-status.js", "track.js"]) {
    runInNewContext(readFileSync(path.join(__dirname, "..", filename), "utf8"), context);
  }
  events.DOMContentLoaded();
  const element = name => elements.get(`#${name}`);

  return {
    element, requests, storage, controls, errors, events,
    signIn(email = "current@example.com") {
      window.WorkoutAuth.user = { email };
      handlers.onSignIn();
    },
    signOut() {
      window.WorkoutAuth.user = null;
      handlers.onSignOut();
    },
    set(field, value) { element(`measurement-${field}`).value = String(value); },
    submit: () => element("measurement-form").events.submit({ preventDefault() {} }),
    retry: () => element("retry-measurements").events.click(),
    changeUnits(nextUnits) {
      const previousUnits = units;
      units = nextUnits;
      events["workout:unitschange"]({ detail: { previousUnits } });
    },
    fieldGroups: () => element("measurement-fields").children.map(fieldset => ({
      title: fieldset.children[0].textContent,
      fields: fieldset.children[1].children.map(label => label.children[0].textContent.split(" (")[0])
    })),
    records: (email = "current@example.com") => JSON.parse(storage.get(storageKey(email)) || "[]")
  };
}

test("renders circumference fields in the requested order", () => {
  const environment = createEnvironment();
  const circumference = environment.fieldGroups().find(group => group.title === "Circumference");
  assert.deepEqual(circumference.fields, [
    "Neck", "Shoulders", "Chest", "Waist", "Belly", "Butt", "Bicep L", "Bicep R",
    "Forearm L", "Forearm R", "Thigh L", "Thigh R", "Calf L", "Calf R"
  ]);
});

test("sends one complete metric response through the shared Forms helper", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.set("date", "2026-10-27");
  for (const field of [
    "neck", "bicepL", "bicepR", "forearmL", "forearmR", "shoulders", "chest", "waist",
    "belly", "butt", "thighL", "thighR", "calfL", "calfR", "weight", "sleep", "water"
  ]) {
    environment.set(field, 12.5);
  }
  environment.set("energy", "strong");
  environment.set("mood", "great");
  await environment.submit();
  assert.equal(environment.requests.length, 1);
  const { url, request } = environment.requests[0];
  assert.equal(url, CONFIGURATION.actionUrl);
  assert.equal(request.method, "POST");
  assert.equal(request.mode, "no-cors");
  assert.equal(request.body.size, FIELD_NAMES.length);
  assert.equal(request.body.get(CONFIGURATION.fields.email), "current@example.com");
  assert.equal(request.body.get(CONFIGURATION.fields.neckCm), "12.5");
  assert.equal(request.body.get(CONFIGURATION.fields.energy), "strong");
  assert.equal(request.body.get(CONFIGURATION.fields.date), "2026-10-27");
  assert.ok(request.body.get(CONFIGURATION.fields.measurementId));
  assert.equal(environment.records()[0].pendingSubmissions.length, 0);
  assert.match(environment.element("measurement-status").textContent, /Measurement submission sent/);
});

test("converts imperial input to canonical form units and preserves zero and optional blanks", async () => {
  const environment = createEnvironment({ units: "imperial" });
  environment.signIn();
  environment.set("neck", 10);
  environment.set("weight", 100);
  environment.set("water", 10);
  environment.set("sleep", 0);
  environment.changeUnits("metric");
  assert.equal(environment.element("measurement-neck").value, "25.4");
  assert.equal(environment.element("measurement-weight").value, "45.36");
  environment.changeUnits("imperial");
  environment.set("weight", 100);
  environment.set("water", 10);
  await environment.submit();
  const body = environment.requests[0].request.body;
  assert.equal(Number(body.get(CONFIGURATION.fields.neckCm)), 25.4);
  assert.equal(Number(body.get(CONFIGURATION.fields.weightKg)), 45.359237);
  assert.equal(Number(body.get(CONFIGURATION.fields.waterLitres)), 0.295735295625);
  assert.equal(body.get(CONFIGURATION.fields.sleepHours), "0");
  assert.equal(body.has(CONFIGURATION.fields.mood), false);
});

test("undo restores cleared fields and date exactly without changing history or pending submissions", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.controls.failNetwork = true;
  environment.set("mood", "good");
  await environment.submit();
  const storedRecords = JSON.stringify(environment.records());
  const requestCount = environment.requests.length;
  environment.set("date", "2026-10-25");
  environment.set("weight", "72.12345");
  environment.set("sleep", "0");
  environment.set("energy", "strong");
  environment.element("clear-measurements").events.click();
  assert.equal(environment.element("measurement-weight").value, "");
  assert.equal(environment.element("measurement-mood").value, "");
  assert.equal(environment.element("undo-clear-measurements").hidden, false);
  assert.equal(environment.element("undo-clear-measurements").focused, true);
  assert.match(environment.element("measurement-status").textContent, /Fields cleared/);
  environment.element("undo-clear-measurements").events.click();
  assert.equal(environment.element("measurement-date").value, "2026-10-25");
  assert.equal(environment.element("measurement-weight").value, "72.12345");
  assert.equal(environment.element("measurement-sleep").value, "0");
  assert.equal(environment.element("measurement-neck").value, "");
  assert.equal(environment.element("measurement-energy").value, "strong");
  assert.equal(environment.element("measurement-mood").value, "good");
  assert.equal(environment.element("undo-clear-measurements").hidden, true);
  assert.equal(environment.element("clear-measurements").focused, true);
  assert.match(environment.element("measurement-status").textContent, /Fields restored/);
  assert.equal(JSON.stringify(environment.records()), storedRecords);
  assert.equal(environment.requests.length, requestCount);
});

test("undo restores cleared values using the current units", () => {
  const environment = createEnvironment({ units: "imperial" });
  environment.signIn();
  environment.set("neck", 10);
  environment.set("weight", 100);
  environment.set("water", 10);
  environment.set("sleep", 8);
  environment.set("mood", "great");
  environment.element("clear-measurements").events.click();
  environment.changeUnits("metric");
  environment.element("undo-clear-measurements").events.click();
  assert.equal(environment.element("measurement-neck").value, "25.4");
  assert.equal(environment.element("measurement-weight").value, "45.36");
  assert.equal(environment.element("measurement-water").value, "0.3");
  assert.equal(environment.element("measurement-sleep").value, "8");
  assert.equal(environment.element("measurement-mood").value, "great");
});

test("editing fields or the date invalidates undo", () => {
  for (const eventName of ["input", "change"]) {
    const environment = createEnvironment();
    environment.signIn();
    environment.set("weight", 80);
    environment.element("clear-measurements").events.click();
    environment.set("date", "2026-10-24");
    environment.element("measurement-form").events[eventName]();
    assert.equal(environment.element("undo-clear-measurements").hidden, true);
    environment.element("undo-clear-measurements").events.click();
    assert.equal(environment.element("measurement-weight").value, "");
    assert.equal(environment.element("measurement-date").value, "2026-10-24");
  }
});

test("sign-out and account switching discard cleared fields", () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.set("weight", 80);
  environment.element("clear-measurements").events.click();
  environment.signOut();
  assert.equal(environment.element("undo-clear-measurements").hidden, true);
  environment.signIn("other@example.com");
  environment.element("undo-clear-measurements").events.click();
  assert.equal(environment.element("measurement-weight").value, "");
  environment.set("weight", 90);
  environment.element("clear-measurements").events.click();
  environment.signIn("current@example.com");
  assert.equal(environment.element("undo-clear-measurements").hidden, true);
  environment.element("undo-clear-measurements").events.click();
  assert.equal(environment.element("measurement-weight").value, "");
});

test("submitting the form discards cleared fields", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.set("weight", 80);
  environment.element("clear-measurements").events.click();
  await environment.submit();
  assert.equal(environment.element("undo-clear-measurements").hidden, true);
  environment.element("undo-clear-measurements").events.click();
  assert.equal(environment.element("measurement-weight").value, "");
  assert.equal(environment.requests.length, 0);
});

test("retains failures across reload and retries on sign-in using the same measurement ID", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.controls.failNetwork = true;
  environment.set("mood", "meh");
  await environment.submit();
  const queued = environment.records()[0].pendingSubmissions[0];
  assert.equal(environment.element("measurement-queue").hidden, false);
  assert.match(environment.element("measurement-status").textContent, /submission is saved on this device/);
  const restored = createEnvironment({ storage: environment.storage });
  restored.signIn();
  await settle();
  assert.equal(restored.requests.length, 1);
  assert.equal(restored.requests[0].request.body.get(CONFIGURATION.fields.measurementId), queued.measurementId);
  assert.equal(restored.records()[0].pendingSubmissions.length, 0);
});

test("online and manual retries retain all submissions for the same date", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.controls.failNetwork = true;
  environment.set("mood", "poor");
  await environment.submit();
  environment.set("mood", "fair");
  await environment.submit();
  assert.equal(environment.records().length, 1);
  assert.equal(environment.records()[0].pendingSubmissions.length, 2);
  assert.equal(environment.records()[0].values.mood, "fair");
  await environment.retry();
  assert.equal(environment.records()[0].pendingSubmissions.length, 2);
  environment.controls.failNetwork = false;
  await environment.events.online();
  assert.equal(environment.records()[0].pendingSubmissions.length, 0);
});

test("sign-out clears fields and never sends another account's pending responses", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.controls.failNetwork = true;
  environment.set("neck", 20);
  await environment.submit();
  environment.signOut();
  assert.equal(environment.element("measurement-neck").value, "");
  const requestCount = environment.requests.length;
  environment.controls.failNetwork = false;
  environment.signIn("other@example.com");
  await environment.events.online();
  assert.equal(environment.requests.length, requestCount);
  assert.equal(environment.records()[0].pendingSubmissions.length, 1);
  environment.set("mood", "good");
  await environment.submit();
  assert.equal(environment.requests.at(-1).request.body.get(CONFIGURATION.fields.email), "other@example.com");
});

test("in-flight completion preserves the original owner after account switching", async () => {
  const environment = createEnvironment();
  environment.signIn();
  let releaseRequest;
  environment.controls.requestBarrier = new Promise(resolve => { releaseRequest = resolve; });
  environment.set("mood", "bad");
  const submission = environment.submit();
  environment.signOut();
  environment.signIn("other@example.com");
  releaseRequest();
  await submission;
  assert.equal(environment.records()[0].pendingSubmissions.length, 0);
  assert.equal(environment.records("other@example.com").length, 0);
  assert.equal(environment.element("measurement-status").textContent, "");
});

test("storage failures prevent sending, and corrupt history is not overwritten", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.controls.failWrite = true;
  environment.set("energy", "spent");
  await environment.submit();
  assert.equal(environment.requests.length, 0);
  assert.match(environment.element("measurement-status").textContent, /Nothing was sent/);
  const storage = new Map([[storageKey("current@example.com"), "{invalid"]]);
  const corrupted = createEnvironment({ storage });
  corrupted.signIn();
  corrupted.set("mood", "great");
  await corrupted.submit();
  assert.equal(corrupted.requests.length, 0);
  assert.equal(storage.get(storageKey("current@example.com")), "{invalid");
});

test("missing and duplicate mappings disable submission and explain setup", async () => {
  for (const configuration of [
    { fields: {} },
    { ...CONFIGURATION, fields: { ...CONFIGURATION.fields, mood: CONFIGURATION.fields.energy } }
  ]) {
    const environment = createEnvironment({ configuration });
    environment.signIn();
    environment.set("mood", "great");
    await environment.submit();
    assert.equal(environment.element("setup-warning").hidden, false);
    assert.equal(environment.element("submit-measurements").disabled, true);
    assert.equal(environment.requests.length, 0);
  }
});

test("rejects empty or invalid data without sending", async () => {
  for (const [field, value] of [["mood", ""], ["neck", -1], ["weight", "NaN"], ["mood", "invalid"]]) {
    const environment = createEnvironment();
    environment.signIn();
    environment.set(field, value);
    await environment.submit();
    assert.equal(environment.requests.length, 0);
    assert.equal(environment.records().length, 0);
  }
});

test("legacy device-only history stays local until explicitly resubmitted", async () => {
  const storage = new Map([[storageKey("current@example.com"),
    JSON.stringify([{ date: "2026-10-26", values: { neck: 30, mood: "fair" } }])]]);
  const environment = createEnvironment({ storage });
  environment.signIn();
  await settle();
  assert.equal(environment.requests.length, 0);
  assert.equal(environment.records()[0].values.neck, 30);
});

test("measurement history is read-only and still displays saved dates and values", async () => {
  const storage = new Map([[storageKey("current@example.com"),
    JSON.stringify([{ date: "2026-10-26", values: { neck: 30, mood: "fair" } }])]]);
  const environment = createEnvironment({ storage });
  environment.signIn();
  await settle();
  const historyEntry = environment.element("measurement-history").children[0].children[0];
  assert.equal(historyEntry.children.length, 1);
  const details = historyEntry.children[0];
  assert.equal(details.children[0].textContent, "2026-10-26");
  assert.deepEqual(details.children[1].children.map(value => value.textContent), [
    "Neck: 30 cm", "Mood: fair"
  ]);
  const assertReadOnly = element => {
    assert.equal(element.events.click, undefined);

    for (const child of element.children) {
      assertReadOnly(child);
    }
  };
  assertReadOnly(historyEntry);
  assert.equal(environment.requests.length, 0);
  assert.equal(environment.element("measurement-neck").value, "");
  assert.equal(environment.element("measurement-mood").value, "");
});

test("submitting the same date adds a new response without replacing an earlier form response", async () => {
  const environment = createEnvironment();
  environment.signIn();
  environment.set("mood", "fair");
  await environment.submit();
  const date = environment.records()[0].date;
  environment.set("date", date);
  environment.set("mood", "great");
  await environment.submit();
  assert.equal(environment.requests.length, 2);
  assert.notEqual(
    environment.requests[0].request.body.get(CONFIGURATION.fields.measurementId),
    environment.requests[1].request.body.get(CONFIGURATION.fields.measurementId)
  );
  assert.equal(environment.records().length, 1);
  assert.equal(environment.records()[0].values.mood, "great");
});

test("a storage failure after sending retains the response for an explicit retry", async () => {
  const environment = createEnvironment();
  environment.signIn();
  let releaseRequest;
  environment.controls.requestBarrier = new Promise(resolve => { releaseRequest = resolve; });
  environment.set("energy", "weak");
  const submission = environment.submit();
  environment.controls.failWrite = true;
  releaseRequest();
  await submission;
  assert.equal(environment.records()[0].pendingSubmissions.length, 1);
  assert.match(environment.element("measurement-status").textContent, /submission is saved on this device/);
  environment.controls.failWrite = false;
  await environment.retry();
  assert.equal(environment.records()[0].pendingSubmissions.length, 0);
  assert.equal(environment.requests.length, 2);
  assert.equal(
    environment.requests[0].request.body.get(CONFIGURATION.fields.measurementId),
    environment.requests[1].request.body.get(CONFIGURATION.fields.measurementId)
  );
});

test("Apps Script creates a separate measurements form with matching mappings and dropdowns", () => {
  const messages = [];
  const items = [];
  let description;
  const responses = [];
  const form = {
    setDescription(value) { description = value; },
    setCollectEmail(value) { assert.equal(value, false); },
    setLimitOneResponsePerUser(value) { assert.equal(value, false); },
    setAcceptingResponses() {}, setRequireLogin() {}, setPublished() {}, setDestination() {},
    getId: () => "measurements-id",
    getEditUrl: () => "editor-url",
    getPublishedUrl: () => "https://docs.google.com/forms/d/e/measurements/viewform",
    addTextItem: addItem,
    addListItem: addItem,
    createResponse: () => ({
      withItemResponse: value => responses.push(value),
      toPrefilledUrl: () => "https://example.test/?" + responses.map((value, index) =>
        `entry.${index + 1}=${encodeURIComponent(value)}`).join("&")
    })
  };
  function addItem() {
    const item = {
      setTitle(value) { this.title = value; return this; },
      setChoiceValues(value) { this.choices = [...value]; return this; },
      createResponse: value => value
    };
    items.push(item);

    return item;
  }
  const context = {
    Logger: { log: message => messages.push(message) },
    SpreadsheetApp: { create: () => ({ getId: () => "sheet", getUrl: () => "sheet-url" }) },
    FormApp: {
      DestinationType: { SPREADSHEET: "spreadsheet" },
      create(title) { assert.equal(title, "Fitness Tracker Measurements"); return form; }
    }
  };
  runInNewContext(readFileSync(path.join(__dirname, "..", "setup", "create-form.gs"), "utf8"), context);
  context.createMeasurementsForm();
  const snippet = messages.find(message => message.includes("\nmeasurementsForm: "));
  const configuration = JSON.parse(snippet.split("\nmeasurementsForm: ")[1]);
  assert.deepEqual(Object.keys(configuration.fields), FIELD_NAMES);
  assert.equal(configuration.formId, "measurements-id");
  assert.equal(configuration.actionUrl, CONFIGURATION.actionUrl);
  assert.ok(Object.values(configuration.fields).every(entry => /^entry\.\d+$/.test(entry)));
  assert.deepEqual(items.find(item => item.title === "Energy").choices, ["spent", "weak", "tired", "fair", "good", "strong"]);
  assert.deepEqual(items.find(item => item.title === "Mood").choices, ["bad", "poor", "meh", "fair", "good", "great"]);
  assert.match(description, /One response per submission/);
});
