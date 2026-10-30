const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { loadInternals, loadUtilities, readSource } = require("./helpers.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
const NAMES = [
  "parseDuration", "formatDuration", "estimateSeconds", "formatEstimate", "validate", "buildRows",
  "routineTemplate", "flushQueue", "readQueue", "writeQueue", "readJson", "writeJson", "showTracker",
  "parseLocalDataExport", "mergeById", "isOwnedBy", "readAccountJson", "writeAccountJson", "accountStorageKey",
  "getLoggedWorkouts"
];

const failWrites = { value: false };

function loadApp({ storage = new Map(), post = async () => {}, configured = true } = {}) {
  failWrites.value = false;
  const window = loadUtilities();
  runInNewContext(readSource("submission-status.js"), { window });
  window.WORKOUT_CONFIG = { form: {} };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites.value) {
        throw new Error("QuotaExceededError");
      }

      storage.set(key, String(value));
    },
    removeItem: key => storage.delete(key)
  };
  const posted = [];
  const app = loadInternals("app.js", NAMES, {
    window, localStorage,
    crypto: { randomUUID: () => "session-1" },
    WorkoutForms: {
      hasSubmissionConfiguration: () => configured,
      postRow: async (configuration, row) => { posted.push(row.id); await post(row); }
    }
  });

  return { app, storage, posted };
}

const ownedRows = (...ids) => ids.map(id => ({ id, email: "a@example.com" }));

function signIn(app, email = "a@example.com") {
  try {
    app.showTracker({ email });
  } catch {
    // The page's DOM rendering is not under test; the signed-in user is set first.
  }
}

test("durations parse from seconds, m:ss and h:mm:ss; blanks are null and junk is NaN", () => {
  const { parseDuration } = loadApp().app;

  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration("   "), null);
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration("0:45"), 45);
  assert.equal(parseDuration("1:30"), 90);
  assert.equal(parseDuration("1:02:03"), 3723);
  assert.ok(Number.isNaN(parseDuration("abc")));
  assert.ok(Number.isNaN(parseDuration("1:234")));
  assert.ok(Number.isNaN(parseDuration("-5")));
});

test("durations format as m:ss with unbounded minutes, and empty for missing values", () => {
  const { formatDuration, parseDuration } = loadApp().app;

  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(600), "10:00");
  assert.equal(formatDuration(5400), "90:00");
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration(NaN), "");
  assert.equal(parseDuration(formatDuration(754)), 754);
});

test("the estimate counts timed sets as entered, 10 s per rep and a minute of rest between sets", () => {
  const { estimateSeconds, formatEstimate } = loadApp().app;
  const workout = {
    exercises: [
      { measure: "reps", sets: [{ reps: 10 }, { reps: 5 }, { reps: null }] },
      { measure: "time", sets: [{ durationSeconds: 45 }, { durationSeconds: NaN }] }
    ]
  };

  assert.equal(estimateSeconds(workout), 100 + 50 + 0 + 45 + 0 + 4 * 60);
  assert.equal(estimateSeconds({ exercises: [] }), 0);
  assert.equal(estimateSeconds({ exercises: [{ measure: "reps", sets: [{ reps: 3 }] }] }), 30);
  assert.equal(formatEstimate(0), "0:00");
  assert.equal(formatEstimate(3599), "59:59");
  assert.equal(formatEstimate(3600), "1:00:00");
  assert.equal(formatEstimate(3725), "1:02:05");
});

test("validation reports the first problem in a way the user can act on", () => {
  const { validate } = loadApp().app;
  const reps = value => ({ name: "Row", measure: "reps", sets: [{ reps: value }] });
  const valid = { date: "2026-10-30", exercises: [reps(5)] };

  assert.equal(validate(valid), null);
  assert.equal(validate({ ...valid, date: "" }), "Please choose a date.");
  assert.equal(validate({ ...valid, date: "" }, { requireDate: false }), null);
  assert.equal(validate({ date: "2026-10-30", exercises: [] }), "Add at least one exercise.");
  assert.equal(validate({ ...valid, exercises: [{ name: "", measure: "reps", sets: [{ reps: 1 }] }] }), "Exercise 1 needs a name.");
  assert.equal(validate({ ...valid, exercises: [{ name: "Row", measure: "reps", sets: [] }] }), "Row has no sets.");
  assert.match(validate({ ...valid, exercises: [reps(null)] }), /Row, set 1: enter the number of reps/);
  assert.match(validate({ ...valid, exercises: [reps(-1)] }), /enter the number of reps/);
  assert.equal(validate({ ...valid, exercises: [reps(0)] }), null);
  assert.match(validate({ ...valid, exercises: [{ name: "Plank", measure: "time", sets: [{ durationSeconds: null }] }] }),
    /Plank, set 1: enter a time/);
  assert.match(validate({ ...valid, exercises: [{ name: "Plank", measure: "time", sets: [{ durationSeconds: NaN }] }] }),
    /enter a time/);
});

test("one form row is built per set, in order, sharing one session id and tagged with the signed-in email", () => {
  const { app } = loadApp();
  signIn(app, "me@example.com");
  const { sessionId, rows } = plain(app.buildRows({
    date: "2026-10-30", routine: "Push", sessionNotes: "good",
    exercises: [
      { name: "Row", measure: "reps", sets: [{ reps: 5, weightKg: 20, rpe: 6, notes: "" }, { reps: 4, weightKg: null, rpe: 7, notes: "slow" }] },
      { name: "Plank", measure: "time", sets: [{ reps: null, durationSeconds: 30, weightKg: null, rpe: 5, notes: "" }] }
    ]
  }));

  assert.equal(sessionId, "session-1");
  assert.deepEqual(rows.map(row => row.id), ["session-1:0:0", "session-1:0:1", "session-1:1:0"]);
  assert.deepEqual(rows.map(row => [row.exercise, row.exerciseOrder, row.setNumber]),
    [["Row", 1, 1], ["Row", 1, 2], ["Plank", 2, 1]]);
  assert.ok(rows.every(row => row.email === "me@example.com" && row.sessionId === "session-1" &&
    row.date === "2026-10-30" && row.routine === "Push" && row.sessionNotes === "good"));
  assert.equal(rows[2].durationSeconds, 30);
});

test("a saved routine keeps only named exercises and only the values that apply to each measure", () => {
  const { routineTemplate } = loadApp().app;

  assert.deepEqual(plain(routineTemplate({
    exercises: [
      { name: "", measure: "reps", sets: [{ reps: 1 }] },
      { name: "Row", measure: "reps", sets: [{ reps: 8, weightKg: 20, durationSeconds: 99 }, { reps: null }] },
      { name: "Plank", measure: "time", sets: [{ reps: 99, durationSeconds: 45, weightKg: null }] }
    ]
  })), [
    { name: "Row", measure: "reps", sets: [{ reps: 8, weightKg: 20 }, {}] },
    { name: "Plank", measure: "time", sets: [{ durationSeconds: 45 }] }
  ]);
});

test("stored JSON falls back when it is missing or corrupt", () => {
  const { app } = loadApp();
  const storage = new Map([["good", "[1]"], ["bad", "{nope"]]);
  const local = { getItem: key => storage.get(key) ?? null };

  assert.deepEqual(plain(app.readJson(local, "good", [])), [1]);
  assert.deepEqual(plain(app.readJson(local, "bad", ["fallback"])), ["fallback"]);
  assert.deepEqual(plain(app.readJson(local, "missing", ["fallback"])), ["fallback"]);
});

const { settle } = require("./helpers.cjs");

// Signing in starts a flush of anything queued, so these tests sign in and let that flush finish.
test("signing in sends the offline queue in order and removes each row only after it was sent", async () => {
  const queue = ownedRows("r1", "r2", "r3");
  const { app, storage, posted } = loadApp({ storage: new Map([["workout.queue", JSON.stringify(queue)]]) });
  signIn(app);
  await settle();

  assert.deepEqual(posted, ["r1", "r2", "r3"]);
  assert.deepEqual(JSON.parse(storage.get("workout.queue")), []);
});

test("a failed send stops the queue, keeps the failed and later rows, and a retry resumes from there", async () => {
  const queue = ownedRows("r1", "r2", "r3");
  let failOn = "r2";
  const { app, storage, posted } = loadApp({
    storage: new Map([["workout.queue", JSON.stringify(queue)]]),
    post: async row => { if (row.id === failOn) { throw new Error("offline"); } }
  });
  signIn(app);
  await settle();

  assert.deepEqual(JSON.parse(storage.get("workout.queue")).map(row => row.id), ["r2", "r3"]);

  failOn = null;
  assert.equal(await app.flushQueue(), true);
  assert.deepEqual(posted, ["r1", "r2", "r2", "r3"]);
  assert.deepEqual(JSON.parse(storage.get("workout.queue")), []);
});

test("the queue is not sent when signed out or when the form is not configured", async () => {
  const queue = JSON.stringify(ownedRows("r1"));
  const signedOut = loadApp({ storage: new Map([["workout.queue", queue]]) });
  const unconfigured = loadApp({ storage: new Map([["workout.queue", queue]]), configured: false });
  signIn(unconfigured.app);

  await settle();
  assert.equal(await signedOut.app.flushQueue(), false);
  assert.equal(await unconfigured.app.flushQueue(), false);
  assert.deepEqual([...signedOut.posted, ...unconfigured.posted], []);
  assert.equal(JSON.parse(signedOut.storage.get("workout.queue")).length, 1);
  assert.equal(JSON.parse(unconfigured.storage.get("workout.queue")).length, 1);
});

test("only the signed-in account's queued sets are sent; another account's rows stay untouched", async () => {
  const queue = [
    { id: "mine-1", email: "a@example.com" },
    { id: "theirs-1", email: "b@example.com" },
    { id: "mine-2", email: "a@example.com" }
  ];
  const { app, storage, posted } = loadApp({ storage: new Map([["workout.queue", JSON.stringify(queue)]]) });
  signIn(app, "a@example.com");
  await settle();

  assert.deepEqual(posted, ["mine-1", "mine-2"]);
  assert.deepEqual(JSON.parse(storage.get("workout.queue")).map(row => row.id), ["theirs-1"]);
});

test("a queue that cannot be rewritten stops after one send instead of resending rows", async () => {
  const { app, storage, posted } = loadApp({ storage: new Map([["workout.queue", JSON.stringify(ownedRows("r1", "r2"))]]) });
  failWrites.value = true;
  signIn(app);
  await settle();

  assert.equal(app.writeQueue([]), false);
  assert.equal(app.writeJson({ setItem() { throw new Error("blocked"); } }, "key", {}), false);
  assert.deepEqual(posted, ["r1"]);
  assert.equal(JSON.parse(storage.get("workout.queue")).length, 2);
});

const exportFile = overrides => JSON.stringify({
  version: 1, email: "a@example.com", draft: { exercises: [] },
  queue: [{ id: "r1", email: "a@example.com", sessionId: "s", date: "2026-10-30", exercise: "Row" }],
  history: [{ sessionId: "s", date: "2026-10-30", exercises: ["Row ×1"] }],
  ...overrides
});

test("an exported file is only accepted for the account that made it and drops malformed entries", () => {
  const { parseLocalDataExport } = loadApp().app;
  const parsed = plain(parseLocalDataExport(exportFile({
    queue: [
      { id: "ok", email: "a@example.com", sessionId: "s", date: "2026-10-30", exercise: "Row" },
      { id: "other", email: "b@example.com", sessionId: "s", date: "2026-10-30", exercise: "Row" },
      { id: "bad-date", email: "a@example.com", sessionId: "s", date: "yesterday", exercise: "Row" },
      "junk"
    ],
    history: [{ sessionId: "s", date: "2026-10-30", exercises: [1] }, { nonsense: true }]
  }), "a@example.com"));

  assert.deepEqual(parsed.queue.map(row => row.id), ["ok"]);
  assert.deepEqual(parsed.history, []);
  assert.deepEqual(parsed.draft, { exercises: [] });
  assert.throws(() => parseLocalDataExport(exportFile(), "b@example.com"), /not a workout export for this account/);
  assert.throws(() => parseLocalDataExport(exportFile({ version: 2 }), "a@example.com"), /not a workout export/);
  assert.throws(() => parseLocalDataExport("{nope", "a@example.com"), /not valid JSON/);
});

test("merging keeps existing items first and skips ones whose id is already known", () => {
  const { mergeById } = loadApp().app;

  assert.deepEqual(plain(mergeById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], item => item.id)),
    [{ id: 1 }, { id: 2 }, { id: 3 }]);
});

const entry = (sessionId, date = "2026-11-04", routine = "Push") => ({ sessionId, date, routine, exercises: [] });

test("recent history and drafts are kept per account, so accounts on one device never see each other's", () => {
  const { app, storage } = loadApp();
  signIn(app, "a@example.com");
  app.writeAccountJson("history", [entry("a1")]);
  app.writeAccountJson("draft", { routine: "A draft" });
  signIn(app, "b@example.com");

  assert.deepEqual(plain(app.readAccountJson("history", [])), []);
  assert.deepEqual(plain(app.readAccountJson("draft", {})), {});
  app.writeAccountJson("history", [entry("b1")]);
  assert.deepEqual([...storage.keys()].filter(key => key.startsWith("workout.")).sort(),
    ["workout.draft:a@example.com", "workout.history:a@example.com", "workout.history:b@example.com"]);
  assert.deepEqual(plain(app.getLoggedWorkouts()).map(workout => workout.date), ["2026-11-04"]);
  assert.equal(app.writeAccountJson("history", []), true);
});

test("nothing is read or written when no account is signed in", () => {
  const { app, storage } = loadApp();

  assert.equal(app.accountStorageKey("history"), "");
  assert.equal(app.writeAccountJson("history", [entry("x")]), false);
  assert.deepEqual(plain(app.readAccountJson("history", ["fallback"])), ["fallback"]);
  assert.equal(storage.size, 0);
});

test("the first account to sign in adopts history and a draft saved before accounts were separated", () => {
  const storage = new Map([
    ["workout.history", JSON.stringify([entry("old1"), entry("old2", "2026-11-03")])],
    ["workout.draft", JSON.stringify({ routine: "Old draft" })]
  ]);
  const { app } = loadApp({ storage });
  signIn(app, "a@example.com");

  assert.deepEqual(plain(app.readAccountJson("history", [])).map(item => item.sessionId), ["old1", "old2"]);
  assert.deepEqual(plain(app.readAccountJson("draft", {})), { routine: "Old draft" });
  assert.equal(storage.has("workout.history"), false);
  assert.equal(storage.has("workout.draft"), false);

  signIn(app, "b@example.com");
  assert.deepEqual(plain(app.readAccountJson("history", [])), []);
});

test("adopting old data merges into an account's existing history and never replaces its draft", () => {
  const storage = new Map([
    ["workout.history", JSON.stringify([entry("old"), entry("shared")])],
    ["workout.draft", JSON.stringify({ routine: "Old draft" })],
    ["workout.history:a@example.com", JSON.stringify([entry("new"), entry("shared")])],
    ["workout.draft:a@example.com", JSON.stringify({ routine: "Current draft" })]
  ]);
  const { app } = loadApp({ storage });
  signIn(app, "a@example.com");

  assert.deepEqual(plain(app.readAccountJson("history", [])).map(item => item.sessionId), ["new", "shared", "old"]);
  assert.deepEqual(plain(app.readAccountJson("draft", {})), { routine: "Current draft" });
  assert.equal(storage.has("workout.history"), false);
  assert.equal(storage.has("workout.draft"), false);
});

test("old data stays where it is when it cannot be moved to the account yet", () => {
  const storage = new Map([["workout.history", JSON.stringify([entry("old")])]]);
  const { app } = loadApp({ storage });
  failWrites.value = true;
  signIn(app, "a@example.com");
  failWrites.value = false;

  assert.equal(storage.has("workout.history"), true);
  assert.equal(storage.has("workout.history:a@example.com"), false);

  signIn(app, "b@example.com");
  assert.deepEqual(plain(app.readAccountJson("history", [])).map(item => item.sessionId), ["old"]);
});
