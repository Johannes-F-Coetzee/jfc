const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { loadInternals, loadUtilities, readSource } = require("./helpers.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
const NAMES = [
  "parseDuration", "formatDuration", "estimateSeconds", "formatEstimate", "validate", "buildRows",
  "routineTemplate", "flushQueue", "readQueue", "writeQueue", "readJson", "showTracker"
];

function loadApp({ storage = new Map(), post = async () => {}, configured = true } = {}) {
  const window = loadUtilities();
  runInNewContext(readSource("submission-status.js"), { window });
  window.WORKOUT_CONFIG = { form: {} };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
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
  const queue = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
  const { app, storage, posted } = loadApp({ storage: new Map([["workout.queue", JSON.stringify(queue)]]) });
  signIn(app);
  await settle();

  assert.deepEqual(posted, ["r1", "r2", "r3"]);
  assert.deepEqual(JSON.parse(storage.get("workout.queue")), []);
});

test("a failed send stops the queue, keeps the failed and later rows, and a retry resumes from there", async () => {
  const queue = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
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
  const queue = JSON.stringify([{ id: "r1" }]);
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
