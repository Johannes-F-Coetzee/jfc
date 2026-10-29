const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { randomUUID } = require("node:crypto");

const FIELD_NAMES = [
  "email", "planId", "planName", "duration", "durationUnit", "startDate",
  "totalRoutines", "routineOrder", "cycleDay", "routine"
];
const CONFIGURATION = {
  formId: "plan-form",
  actionUrl: "https://docs.google.com/forms/d/e/plan-form/formResponse",
  fields: Object.fromEntries(FIELD_NAMES.map((field, index) => [field, `entry.${index + 1}`]))
};
const PLAN = {
  name: "Strength cycle", duration: 2, unit: "weeks", startDate: "2026-11-02",
  routines: { "1": ["Push", "Run"], "14": ["Pull"] }
};

function storedRows(planId = "saved-plan", email = "current@example.com", name = PLAN.name) {
  return Object.entries(PLAN.routines).flatMap(([day, routines]) =>
    routines.map(routine => ({ cycleDay: day, routine }))
  ).map((routine, index) => ({
    ...routine, email, planId, planName: name, duration: "2", durationUnit: "weeks",
    startDate: PLAN.startDate, totalRoutines: "3", routineOrder: String(index + 1)
  }));
}

function createEnvironment(initialRows = [], options = {}) {
  const rows = structuredClone(initialRows);
  const storage = new Map();
  const requests = [];
  let posts = 0;
  const context = {
    URLSearchParams, AbortController, console,
    crypto: { randomUUID },
    setTimeout: callback => { queueMicrotask(callback); return 1; },
    clearTimeout() {},
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    WorkoutAuth: {
      user: { email: "current@example.com" },
      getFormsAccessToken: async () => "test-access-token",
      clearCachedToken() {}
    },
    fetch: async (url, request = {}) => {
      requests.push({ url, request });

      if (request.method === "POST") {
        posts += 1;

        if (options.failPost === posts) {
          throw new Error("Network failure");
        }

        if (!options.dropPosts) {
          rows.push(Object.fromEntries(FIELD_NAMES.map((field, index) =>
            [field, request.body.get(`entry.${index + 1}`)])));
        }

        if (options.switchOnPost === posts) {
          context.WorkoutAuth.user = { email: "other@example.com" };
        }

        return { type: "opaque" };
      }

      if (options.status) {
        return { ok: false, status: options.status, json: async () => ({ error: { message: "Read denied" } }) };
      }

      if (url.includes("/responses?")) {
        const parameters = new URL(url).searchParams;
        const start = Number(parameters.get("pageToken") || 0);

        return {
          ok: true,
          json: async () => ({
            responses: rows.slice(start, start + 2).map(row => ({
              answers: Object.fromEntries(FIELD_NAMES.flatMap((field, index) =>
                row[field] === undefined ? [] : [
                  [(index + 1).toString(16), { textAnswers: { answers: [{ value: String(row[field]) }] } }]
                ]))
            })),
            nextPageToken: start + 2 < rows.length ? String(start + 2) : ""
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          items: FIELD_NAMES.filter(field => field !== options.missingField).map(field => ({
            questionItem: { question: { questionId: (FIELD_NAMES.indexOf(field) + 1).toString(16) } }
          }))
        })
      };
    }
  };
  context.window = context;
  context.WORKOUT_CONFIG = { planForm: structuredClone(CONFIGURATION) };

  for (const script of ["google-forms.js", "plans.js"]) {
    runInNewContext(readFileSync(path.join(__dirname, "..", script), "utf8"), context, { filename: script });
  }

  return { context, rows, storage, requests, options, get posts() { return posts; } };
}

const plain = value => JSON.parse(JSON.stringify(value));

test("saves one row per scheduled routine with plan details repeated and confirms by reading back", async () => {
  const environment = createEnvironment();
  const catalog = await environment.context.WorkoutPlans.save(PLAN);
  assert.equal(environment.posts, 3);
  assert.equal(catalog.plans.size, 1);
  assert.deepEqual(plain([...catalog.plans.values()][0]), PLAN);
  assert.equal(new Set(environment.rows.map(row => row.planId)).size, 1);
  assert.ok(environment.rows.every(row => row.email === "current@example.com" &&
    row.planName === PLAN.name && row.duration === "2" && row.durationUnit === "weeks" &&
    row.startDate === PLAN.startDate && row.totalRoutines === "3"));
  assert.equal(environment.storage.size, 0);
});

test("loads only the current account across paginated responses and preserves per-day order", async () => {
  const ownRows = storedRows();
  const environment = createEnvironment([
    ...storedRows("other-plan", "other@example.com"),
    ownRows[2], ownRows[1], ownRows[0]
  ]);
  const catalog = await environment.context.WorkoutPlans.load();
  assert.equal(catalog.plans.size, 1);
  assert.deepEqual(plain(catalog.plans.get("saved-plan")), PLAN);
  assert.equal(catalog.rows.length, 3);
  assert.equal(catalog.warnings.length, 0);
  assert.equal(environment.requests.filter(({ url }) => url.includes("/responses?")).length, 3);
});

test("same names across accounts are allowed, but case-insensitive own names cannot be overwritten", async () => {
  const environment = createEnvironment(storedRows("other-plan", "other@example.com"));
  await environment.context.WorkoutPlans.save(PLAN);
  const posts = environment.posts;
  await assert.rejects(environment.context.WorkoutPlans.save({ ...PLAN, name: " STRENGTH CYCLE " }), /already exists/);
  assert.equal(environment.posts, posts);
});

test("incomplete snapshots reserve their name but are withheld from loading", async () => {
  const environment = createEnvironment(storedRows().slice(0, 1));
  const catalog = await environment.context.WorkoutPlans.load();
  assert.equal(catalog.plans.size, 0);
  assert.match(catalog.warnings.join(" "), /Incomplete/);
  await assert.rejects(environment.context.WorkoutPlans.save(PLAN), /already exists/);
  assert.equal(environment.posts, 0);
});

test("conflicting snapshot names and duplicate rows are reported", async () => {
  const conflict = createEnvironment([...storedRows(), ...storedRows("different-plan")]);
  assert.match((await conflict.context.WorkoutPlans.load()).warnings.join(" "), /Multiple snapshots/);
  const rows = storedRows();
  rows[1] = { ...rows[0] };
  const duplicate = createEnvironment(rows);
  const catalog = await duplicate.context.WorkoutPlans.load();
  assert.equal(catalog.plans.size, 0);
  assert.match(catalog.warnings.join(" "), /duplicate routine order/);
});

test("rejects invalid metadata, dates and out-of-cycle routine rows", async () => {
  for (const change of [
    { duration: "0" }, { durationUnit: "months" }, { startDate: "2026-11-03" },
    { startDate: "2026-02-30" }, { cycleDay: "15" }, { routine: "" }
  ]) {
    const rows = storedRows().map(row => ({ ...row, ...change }));
    const environment = createEnvironment(rows);
    const catalog = await environment.context.WorkoutPlans.load();
    assert.equal(catalog.plans.size, 0, JSON.stringify(change));
    assert.ok(catalog.warnings.length > 0);
  }
});

test("empty, malformed and impossible plans never post", async () => {
  const environment = createEnvironment();
  for (const plan of [
    { ...PLAN, routines: {} },
    { ...PLAN, routines: { "15": ["Push"] } },
    { ...PLAN, routines: { "1": ["Push", "Push"] } },
    { ...PLAN, startDate: "2026-11-03" },
    { ...PLAN, unit: "days", duration: 2, startDate: "9999-12-31" }
  ]) {
    await assert.rejects(environment.context.WorkoutPlans.save(plan));
  }
  assert.equal(environment.posts, 0);
});

test("partial failures resume missing rows without reposting confirmed rows", async () => {
  const environment = createEnvironment([], { failPost: 2 });
  await assert.rejects(environment.context.WorkoutPlans.save(PLAN), /Save was not confirmed/);
  assert.equal(environment.rows.length, 1);
  assert.equal(environment.storage.size, 1);
  environment.options.failPost = null;
  await environment.context.WorkoutPlans.save(PLAN);
  assert.equal(environment.rows.length, 3);
  assert.equal(environment.posts, 4);
  assert.equal(new Set(environment.rows.map(row => row.planId)).size, 1);
  assert.equal(environment.storage.size, 0);
});

test("retry detects conflicting confirmed rows and does not append more", async () => {
  const environment = createEnvironment([], { failPost: 2 });
  await assert.rejects(environment.context.WorkoutPlans.save(PLAN));
  environment.rows[0].routine = "Conflicting routine";
  environment.options.failPost = null;
  await assert.rejects(environment.context.WorkoutPlans.save(PLAN), /Stored rows conflict/);
  assert.equal(environment.rows.length, 1);
});

test("opaque post success alone cannot report a confirmed save", async () => {
  const environment = createEnvironment([], { dropPosts: true });
  await assert.rejects(environment.context.WorkoutPlans.save(PLAN), /Save was not confirmed/);
  assert.equal(environment.storage.size, 1);
});

test("account changes stop posting and keep pending recovery data", async () => {
  const environment = createEnvironment([], { switchOnPost: 1 });
  await assert.rejects(environment.context.WorkoutPlans.save(PLAN), /account changed/);
  assert.equal(environment.posts, 1);
  assert.equal(environment.storage.size, 1);
});

test("requires configuration, unique entry mappings, sign-in and readable required questions", async () => {
  const unconfigured = createEnvironment();
  unconfigured.context.WORKOUT_CONFIG.planForm.fields.planName = "";
  assert.equal(unconfigured.context.WorkoutPlans.isConfigured(), false);
  await assert.rejects(unconfigured.context.WorkoutPlans.load(), /Set up planForm/);
  const duplicateMapping = createEnvironment();
  duplicateMapping.context.WORKOUT_CONFIG.planForm.fields.planName = "entry.1";
  assert.equal(duplicateMapping.context.WorkoutPlans.isConfigured(), false);
  const signedOut = createEnvironment();
  signedOut.context.WorkoutAuth.user = null;
  await assert.rejects(signedOut.context.WorkoutPlans.load(), /Sign in/);
  const missingField = createEnvironment([], { missingField: "cycleDay" });
  await assert.rejects(missingField.context.WorkoutPlans.load(), /missing required questions/);
  const denied = createEnvironment([], { status: 403 });
  await assert.rejects(denied.context.WorkoutPlans.load(), /Read denied/);
});

test("day cycles need not start on Monday and retain the same one-routine-per-row shape", async () => {
  const environment = createEnvironment();
  const plan = { ...PLAN, unit: "days", duration: 14, startDate: "2026-11-04" };
  const catalog = await environment.context.WorkoutPlans.save(plan);
  assert.deepEqual(plain([...catalog.plans.values()][0]), plan);
});

test("setup creates the plan form with all entry mappings and one-routine-per-row description", () => {
  const snippets = [];
  const questions = [];
  const responses = [];
  let description = "";
  const context = {
    Logger: { log: message => snippets.push(message) },
    SpreadsheetApp: { create: () => ({ getId: () => "sheet", getUrl: () => "sheet-url" }) },
    FormApp: {
      DestinationType: { SPREADSHEET: "sheet" },
      create: title => {
        assert.equal(title, "Fitness Tracker Plans");

        return {
          setDescription: value => { description = value; },
          setCollectEmail: value => assert.equal(value, false),
          setLimitOneResponsePerUser: value => assert.equal(value, false),
          setAcceptingResponses: value => assert.equal(value, true),
          setRequireLogin: value => assert.equal(value, false),
          setPublished: value => assert.equal(value, true),
          setDestination() {},
          getId: () => "plan-form",
          getEditUrl: () => "editor-url",
          getPublishedUrl: () => "https://docs.google.com/forms/d/e/plan-test/viewform",
          addTextItem: () => ({
            setTitle(value) { questions.push(value); return this; },
            createResponse: value => value
          }),
          createResponse: () => ({
            withItemResponse: value => responses.push(value),
            toPrefilledUrl: () => "https://example.test/?" + responses.map((value, index) =>
              `entry.${index + 1}=${value}`).join("&")
          })
        };
      }
    }
  };
  runInNewContext(readFileSync(path.join(__dirname, "..", "setup", "create-form.gs"), "utf8"), context);
  context.createWorkoutPlanForm();
  const snippet = snippets.find(message => message.includes("\nplanForm: "));
  const configuration = JSON.parse(snippet.split("\nplanForm: ")[1]);
  assert.deepEqual(Object.keys(configuration.fields), FIELD_NAMES);
  assert.ok(Object.values(configuration.fields).every(entry => /^entry\.\d+$/.test(entry)));
  assert.equal(configuration.formId, "plan-form");
  assert.equal(configuration.actionUrl, "https://docs.google.com/forms/d/e/plan-test/formResponse");
  assert.equal(questions.length, FIELD_NAMES.length);
  assert.match(description, /One response per scheduled routine/);
});
