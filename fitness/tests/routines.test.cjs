const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { randomUUID } = require("node:crypto");

const FIELD_NAMES = [
  "email", "configurationId", "routine", "totalSets", "estimatedSeconds", "exercise",
  "exerciseOrder", "setNumber", "measure", "reps", "durationSeconds", "weightKg"
];
const CONFIGURATION = {
  formId: "configuration-form",
  actionUrl: "https://docs.google.com/forms/d/e/configuration-form/formResponse",
  fields: Object.fromEntries(FIELD_NAMES.map((field, index) => [field, `entry.${index + 1}`]))
};
const ROUTINE = {
  name: "Shared workout",
  exercises: [
    { name: "Row", measure: "reps", sets: [{ reps: 12, weightKg: 5 }, { reps: 0 }] },
    { name: "Row", measure: "time", sets: [{ durationSeconds: 30 }] }
  ]
};

function storedRows(configurationId = "saved-id", name = ROUTINE.name) {
  return ROUTINE.exercises.flatMap((exercise, exerciseIndex) =>
    exercise.sets.map((set, setIndex) => ({
      ...set, configurationId, routine: name, email: "other@example.com",
      totalSets: 3, estimatedSeconds: 270, exercise: exercise.name,
      exerciseOrder: exerciseIndex + 1, setNumber: setIndex + 1, measure: exercise.measure
    })));
}

function createEnvironment(initialRows = [], options = {}) {
  const rows = initialRows.map(row => Object.fromEntries(
    Object.entries(row).map(([field, value]) => [field, String(value)])
  ));
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
    sessionStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {}
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
          rows.push(Object.fromEntries(FIELD_NAMES.flatMap((field, index) => {
            const value = request.body.get(`entry.${index + 1}`);

            return value === null ? [] : [[field, value]];
          })));
        }

        return { type: "opaque" };
      }

      if (options.status) {
        return {
          ok: false, status: options.status,
          json: async () => ({ error: { message: "Read denied" } })
        };
      }

      if (url.includes("/responses?")) {
        const parameters = new URL(url).searchParams;
        const start = Number(parameters.get("pageToken") || 0);
        const pageRows = rows.slice(start, start + 2);

        return {
          ok: true,
          json: async () => ({
            responses: pageRows.map(row => ({
              answers: Object.fromEntries(FIELD_NAMES.flatMap((field, index) =>
                row[field] === undefined ? [] : [
                  [(index + 1).toString(16), { textAnswers: { answers: [{ value: row[field] }] } }]
                ]))
            })),
            nextPageToken: start + 2 < rows.length ? String(start + 2) : ""
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          items: FIELD_NAMES.map((field, index) => ({
            title: field,
            questionItem: { question: { questionId: (index + 1).toString(16) } }
          }))
        })
      };
    }
  };
  context.window = context;
  context.WORKOUT_CONFIG = { configurationForm: structuredClone(CONFIGURATION) };

  for (const script of ["google-forms.js", "routines.js"]) {
    runInNewContext(readFileSync(path.join(__dirname, "..", script), "utf8"), context, { filename: script });
  }

  return { context, rows, storage, requests, options, get posts() { return posts; } };
}

const plain = value => JSON.parse(JSON.stringify(value));

test("loads all users' sets across pages, preserving exercise and set order", async () => {
  const rows = storedRows();
  const environment = createEnvironment([rows[2], rows[1], rows[0]]);
  const catalog = await environment.context.WorkoutRoutines.load();
  const routine = catalog.routines.get(ROUTINE.name);
  assert.deepEqual(plain(routine.exercises), ROUTINE.exercises);
  assert.equal(routine.savedBy, "other@example.com");
  assert.equal(routine.estimatedSeconds, 270);
  assert.equal(catalog.warnings.length, 0);
  assert.equal(environment.requests.filter(request => request.url.includes("/responses?")).length, 2);
  assert.ok(environment.requests.every(({ request }) => request.cache === "no-store"));
});

test("saves one response per set with shared identity, author and estimated time", async () => {
  const environment = createEnvironment();
  const catalog = await environment.context.WorkoutRoutines.save(ROUTINE, 270);
  assert.equal(environment.posts, 3);
  assert.equal(catalog.routines.size, 1);
  assert.deepEqual(plain(catalog.routines.get(ROUTINE.name).exercises), ROUTINE.exercises);
  assert.equal(new Set(environment.rows.map(row => row.configurationId)).size, 1);
  assert.ok(environment.rows.every(row => row.email === "current@example.com" &&
    row.estimatedSeconds === "270" && row.totalSets === "3"));
  assert.equal(environment.storage.size, 0);
  assert.ok(environment.requests.filter(({ request }) => request.method === "POST")
    .every(({ request }) => request.mode === "no-cors"));
});

test("rejects case-insensitive existing names without posting or replacing", async () => {
  const environment = createEnvironment(storedRows());
  await assert.rejects(environment.context.WorkoutRoutines.save({
    ...ROUTINE, name: "  shared WORKOUT  "
  }, 270), /already exists/);
  assert.equal(environment.posts, 0);
});

test("incomplete configurations reserve their name but are not loadable", async () => {
  const environment = createEnvironment(storedRows().slice(0, 1));
  const catalog = await environment.context.WorkoutRoutines.load();
  assert.equal(catalog.routines.size, 0);
  assert.match(catalog.warnings.join(" "), /Incomplete/);
  await assert.rejects(environment.context.WorkoutRoutines.save(ROUTINE, 270), /already exists/);
});

test("name conflicts are reported rather than silently choosing one configuration", async () => {
  const environment = createEnvironment([...storedRows(), ...storedRows("other-id", "SHARED WORKOUT")]);
  const catalog = await environment.context.WorkoutRoutines.load();
  assert.equal(catalog.routines.size, 0);
  assert.match(catalog.warnings.join(" "), /Multiple configurations/);
});

test("malformed sets are reported while unrelated valid configurations remain available", async () => {
  const invalidRows = storedRows("invalid-id", "Invalid");
  invalidRows[1].reps = "NaN";
  const environment = createEnvironment([...invalidRows, ...storedRows()]);
  const catalog = await environment.context.WorkoutRoutines.load();
  assert.equal(catalog.routines.size, 1);
  assert.match(catalog.warnings.join(" "), /Invalid reps/);
});

test("duplicate sets are not silently loaded", async () => {
  const rows = storedRows();
  rows[1] = { ...rows[0] };
  const environment = createEnvironment(rows);
  const catalog = await environment.context.WorkoutRoutines.load();
  assert.equal(catalog.routines.size, 0);
  assert.match(catalog.warnings.join(" "), /duplicate set/);
});

test("partial network failures can resume without reposting confirmed sets", async () => {
  const environment = createEnvironment([], { failPost: 2 });
  await assert.rejects(environment.context.WorkoutRoutines.save(ROUTINE, 270), /Retry.*resume/);
  assert.equal(environment.rows.length, 1);
  assert.equal(environment.storage.size, 1);
  environment.options.failPost = null;
  const catalog = await environment.context.WorkoutRoutines.save(ROUTINE, 270);
  assert.equal(environment.rows.length, 3);
  assert.equal(environment.posts, 4);
  assert.equal(catalog.routines.size, 1);
  assert.equal(environment.storage.size, 0);
});

test("opaque POST completion is not treated as successful storage", async () => {
  const environment = createEnvironment([], { dropPosts: true });
  await assert.rejects(environment.context.WorkoutRoutines.save(ROUTINE, 270), /Not all sets could be confirmed/);
  assert.equal(environment.storage.size, 1);
});

test("read failures explain form permissions and prevent writes", async () => {
  const environment = createEnvironment([], { status: 403 });
  await assert.rejects(environment.context.WorkoutRoutines.save(ROUTINE, 270), /Every tracker user needs edit access/);
  assert.equal(environment.posts, 0);
});

test("invalid configuration fields and missing sign-in are explicit errors", async () => {
  const environment = createEnvironment();
  environment.context.WORKOUT_CONFIG.configurationForm.fields.weightKg = "";
  assert.equal(environment.context.WorkoutRoutines.isConfigured(), false);
  await assert.rejects(environment.context.WorkoutRoutines.load(), /Set up configurationForm/);
  environment.context.WorkoutAuth.user = null;
  await assert.rejects(environment.context.WorkoutRoutines.load(), /Sign in/);
});

test("invalid set values are rejected before posting", async () => {
  const environment = createEnvironment();
  const routine = structuredClone(ROUTINE);
  routine.exercises[0].sets[0].weightKg = -1;
  await assert.rejects(environment.context.WorkoutRoutines.save(routine, 270), /Invalid weight/);
  assert.equal(environment.posts, 0);
});

test("question titles map fields when question IDs do not match entries (trends compatibility)", () => {
  const environment = createEnvironment();
  const map = environment.context.WorkoutForms.buildQuestionMap(
    { fields: { email: "entry.1" } },
    { items: [{ title: " Email ", questionItem: { question: { questionId: "beef" } } }] },
    { email: "email" }
  );
  assert.equal(map.get("beef"), "email");
});

test("setup creates separate log and configuration forms with all required entry mappings", () => {
  const snippets = [];
  const createdForms = [];
  const context = {
    Logger: { log: message => snippets.push(message) },
    SpreadsheetApp: { create: () => ({ getId: () => "sheet", getUrl: () => "sheet-url" }) },
    FormApp: {
      DestinationType: { SPREADSHEET: "spreadsheet" },
      create: title => {
        const responses = [];
        const form = {
          title,
          setDescription() {}, setCollectEmail() {}, setLimitOneResponsePerUser() {},
          setAcceptingResponses() {}, setRequireLogin() {}, setPublished() {}, setDestination() {},
          getId: () => title,
          getEditUrl: () => "editor-url",
          getPublishedUrl: () => "https://docs.google.com/forms/d/e/test/viewform",
          addTextItem: () => ({
            setTitle() { return this; },
            createResponse: value => value
          }),
          createResponse: () => ({
            withItemResponse: value => responses.push(value),
            toPrefilledUrl: () => "https://example.test/?" + responses.map((value, index) =>
              `entry.${index + 1}=${value}`).join("&")
          })
        };
        createdForms.push(form);

        return form;
      }
    }
  };
  runInNewContext(readFileSync(path.join(__dirname, "..", "setup", "create-form.gs"), "utf8"), context);
  context.createWorkoutForm();
  context.createWorkoutConfigurationForm();
  assert.equal(createdForms.length, 2);
  assert.notEqual(createdForms[0].title, createdForms[1].title);
  const configurationSnippet = snippets.find(message => message.includes("\nconfigurationForm: "));
  const configuration = JSON.parse(configurationSnippet.split("\nconfigurationForm: ")[1]);
  assert.deepEqual(Object.keys(configuration.fields), FIELD_NAMES);
  assert.ok(Object.values(configuration.fields).every(entry => /^entry\.\d+$/.test(entry)));
  assert.equal(configuration.actionUrl, "https://docs.google.com/forms/d/e/test/formResponse");
  assert.ok(snippets.some(message => message.includes("\nform: ")));
});

test("a damaged pending-save entry is ignored and the save still completes", async () => {
  const environment = createEnvironment();
  environment.storage.set(`workout.pendingConfiguration:current@example.com:${ROUTINE.name.toLowerCase()}`, "{not json");
  const catalog = await environment.context.WorkoutRoutines.save(ROUTINE, 270);

  assert.ok(catalog.routines.has(ROUTINE.name));
});

test("saving stops with a clear error when the signed-in account changes during the read", async () => {
  const environment = createEnvironment();
  const originalLoad = environment.context.WorkoutAuth.getFormsAccessToken;
  environment.context.WorkoutAuth.getFormsAccessToken = async () => {
    environment.context.WorkoutAuth.user = { email: "someone-else@example.com" };

    return originalLoad();
  };

  await assert.rejects(environment.context.WorkoutRoutines.save(ROUTINE, 270), /signed-in account changed/);
  assert.equal(environment.posts, 0);
});
