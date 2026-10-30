const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { loadInternals, loadUtilities, readSource } = require("./helpers.cjs");

// Objects built inside a vm context have a different prototype, so compare through JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const NOW = Date.parse("2026-10-30T12:00:00Z");

function loadTrends({ range = "0" } = {}) {
  const window = loadUtilities();
  const formsWindow = {};
  runInNewContext(readSource("google-forms.js"), { window: formsWindow });
  const settings = { units: "metric", weightUnit: "kg", weightFromKg: value => value };
  const document = { querySelector: () => ({ value: range }), querySelectorAll: () => [], addEventListener() {} };

  class FixedDate extends Date {
    static now() { return NOW; }
  }

  return loadInternals("trends.js", [
    "formatDuration", "toWorkoutRow", "toMeasurementRow", "latestMeasurementEntries", "inRange", "groupBy",
    "calculateWorkSeconds", "summarizeSessions", "exerciseSessions", "metricsFor", "calculateAverage",
    "formatNumber", "lineChart", "describeChart", "measurementMetricValue", "formatMeasurementValue"
  ], { window, document, WorkoutForms: formsWindow.WorkoutForms, WorkoutSettings: settings, Date: FixedDate });
}

// A Google Forms response whose question IDs are the field names.
function response(fields, submitted = "2026-10-28T08:00:00Z") {
  return {
    lastSubmittedTime: submitted,
    answers: Object.fromEntries(Object.entries(fields).map(([field, value]) =>
      [field, { textAnswers: { answers: [{ value: String(value) }] } }]))
  };
}

const questionMap = fields => new Map(Object.keys(fields).map(field => [field, field]));
const workoutRow = (fields, submitted) => loadTrends().toWorkoutRow(response(fields, submitted), questionMap(fields));
const measurementRow = (fields, submitted) =>
  loadTrends().toMeasurementRow(response(fields, submitted), questionMap(fields));

test("workout responses are normalised: email case, blanks become null, zero is kept", () => {
  const row = workoutRow({
    email: "  Person@Example.COM ", sessionId: "s1", date: "2026-10-27", routine: " Push ",
    exercise: " Row ", setNumber: "2", measure: "reps", reps: "0", durationSeconds: "", weightKg: "", rpe: "7"
  });

  assert.equal(row.email, "person@example.com");
  assert.equal(row.routine, "Push");
  assert.equal(row.exercise, "Row");
  assert.equal(row.reps, 0);
  assert.equal(row.durationSeconds, null);
  assert.equal(row.weightKg, null);
  assert.equal(row.rpe, 7);
  assert.equal(row.setNumber, 2);
});

test("workout responses fall back sensibly: unknown measure is reps, bad date uses the submit date", () => {
  const row = workoutRow({ email: "a@b.c", exercise: "Row", date: "27/10/2026", measure: "weird" });

  assert.equal(row.measure, "reps");
  assert.equal(row.date, "2026-10-28");
  assert.equal(workoutRow({ exercise: "Row", measure: "time" }).measure, "time");
});

test("responses without a session id get a stable composite id so their sets still group together", () => {
  const first = workoutRow({ email: "a@b.c", date: "2026-10-27", routine: "Push", exercise: "Row" }, "2026-10-27T10:05:00Z");
  const second = workoutRow({ email: "A@B.C", date: "2026-10-27", routine: "Push", exercise: "Dip" }, "2026-10-27T10:59:00Z");
  const otherHour = workoutRow({ email: "a@b.c", date: "2026-10-27", routine: "Push", exercise: "Row" }, "2026-10-27T11:05:00Z");

  assert.equal(first.sessionId, second.sessionId);
  assert.notEqual(first.sessionId, otherHour.sessionId);
});

test("measurement responses reject negative and non-numeric values and unknown energy or mood options", () => {
  const row = measurementRow({
    email: "A@B.C", date: "2026-10-28", weightKg: "81.5", sleepHours: "-3", waterLitres: "lots",
    waistCm: "0", energy: "good", mood: "ecstatic"
  });

  assert.equal(row.weightKg, 81.5);
  assert.equal(row.sleepHours, null);
  assert.equal(row.waterLitres, null);
  assert.equal(row.waistCm, 0);
  assert.equal(row.energy, "good");
  assert.equal(row.mood, "");
  assert.equal(row.email, "a@b.c");
});

test("measurement dates fall back to the submit date, or stay empty when neither is valid", () => {
  assert.equal(measurementRow({ weightKg: "80", date: "nope" }, "2026-09-01T08:00:00Z").date, "2026-09-01");
  assert.equal(measurementRow({ weightKg: "80", date: "nope" }, "garbage").date, "");
});

test("latest measurement entry per user and date wins; empty and undated rows are dropped; output is date-sorted", () => {
  const { latestMeasurementEntries } = loadTrends();
  // Build rows through the real parser so every metric field is present, as in production.
  const row = (email, date, weightKg, submitted) => measurementRow(
    { email, date, ...(weightKg === null ? {} : { weightKg }) }, submitted);
  const result = plain(latestMeasurementEntries([
    row("a", "2026-10-02", 80, "2026-10-02T08:00:00Z"),
    row("a", "2026-10-01", 81, "2026-10-01T08:00:00Z"),
    row("a", "2026-10-02", 79, "2026-10-02T09:00:00Z"),
    row("a", "2026-10-02", 70, "2026-10-02T07:00:00Z"),
    row("b", "2026-10-02", 90, "2026-10-02T08:00:00Z"),
    row("a", "", 75, "garbage"),
    row("a", "2026-10-03", null, "2026-10-03T08:00:00Z")
  ]));

  assert.deepEqual(result.map(entry => [entry.email, entry.date, entry.weightKg]), [
    ["a", "2026-10-01", 81], ["a", "2026-10-02", 79], ["b", "2026-10-02", 90]
  ]);
});

test("a measurement row with missing metric fields is treated as empty, not as a value", () => {
  const { latestMeasurementEntries } = loadTrends();

  assert.deepEqual(plain(latestMeasurementEntries([{ email: "a", date: "2026-10-01", submitted: "2026-10-01T08:00:00Z" }])), []);
  assert.equal(latestMeasurementEntries([{ email: "a", date: "2026-10-01", submitted: "x", weightKg: 80 }]).length, 1);
});

test("a session's estimate adds work time and one minute of rest between sets", () => {
  const { summarizeSessions } = loadTrends();
  const set = (sessionId, date, fields) => ({
    sessionId, date, routine: "Push", measure: "reps", reps: null, durationSeconds: null, rpe: null, ...fields
  });
  const sessions = plain(summarizeSessions([
    set("b", "2026-10-02", { reps: 10, rpe: 6 }),
    set("b", "2026-10-02", { measure: "time", durationSeconds: 45, rpe: 8 }),
    set("a", "2026-10-01", { reps: 5, routine: "" })
  ]));

  assert.equal(sessions[0].date, "2026-10-01");
  assert.equal(sessions[0].routine, "(no routine)");
  assert.equal(sessions[0].estimatedSeconds, 50);
  assert.equal(sessions[1].sets, 2);
  assert.equal(sessions[1].estimatedSeconds, 10 * 10 + 45 + 60);
  assert.equal(sessions[1].averagePerceivedExertion, 7);
});

test("work seconds ignore missing values in either measure", () => {
  const { calculateWorkSeconds } = loadTrends();

  assert.equal(calculateWorkSeconds({ measure: "reps", reps: 3 }), 30);
  assert.equal(calculateWorkSeconds({ measure: "reps", reps: null }), 0);
  assert.equal(calculateWorkSeconds({ measure: "time", durationSeconds: 20, reps: 99 }), 20);
  assert.equal(calculateWorkSeconds({ measure: "time", durationSeconds: null }), 0);
});

test("exercise sessions total reps, find bests, ignore zero weights, and compute volume per session", () => {
  const { exerciseSessions } = loadTrends();
  const set = (sessionId, date, fields) => ({
    sessionId, date, routine: "Push", exercise: "Row", reps: null, durationSeconds: null, weightKg: null, rpe: null, ...fields
  });
  const sessions = plain(exerciseSessions([
    set("b", "2026-10-08", { reps: 8, weightKg: 50, rpe: 8 }),
    set("a", "2026-10-01", { reps: 10, weightKg: 0 }),
    set("a", "2026-10-01", { reps: 6, weightKg: 40, rpe: 6 }),
    set("c", "2026-10-09", { exercise: "Other", reps: 99 })
  ], "Row"));

  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map(session => session.date), ["2026-10-01", "2026-10-08"]);
  assert.equal(sessions[0].totalRepetitions, 16);
  assert.equal(sessions[0].bestRepetitions, 10);
  assert.equal(sessions[0].maximumWeight, 40);
  assert.equal(sessions[0].volume, 6 * 40);
  assert.equal(sessions[0].averagePerceivedExertion, 6);
  assert.equal(sessions[1].volume, 400);
});

test("exercise metrics that have no data are NaN (serialised as null) rather than zero", () => {
  const { exerciseSessions } = loadTrends();
  const [session] = plain(exerciseSessions([
    { sessionId: "a", date: "2026-10-01", exercise: "Plank", durationSeconds: 30, reps: null, weightKg: null, rpe: null }
  ], "Plank"));

  assert.equal(session.totalDurationSeconds, 30);
  assert.equal(session.totalRepetitions, null);
  assert.equal(session.maximumWeight, null);
  assert.equal(session.averagePerceivedExertion, null);
});

test("only metrics with data are offered, and volume needs a positive value", () => {
  const { metricsFor } = loadTrends();

  assert.deepEqual(plain(metricsFor([{ totalRepetitions: 10, bestRepetitions: 5, volume: 0 }])),
    ["totalRepetitions", "bestRepetitions"]);
  assert.deepEqual(plain(metricsFor([{ totalDurationSeconds: 30, volume: 200, maximumWeight: 20 }])),
    ["totalDurationSeconds", "maximumWeight", "volume"]);
  assert.deepEqual(plain(metricsFor([])), []);
});

test("the period filter keeps rows on or after the cutoff and all rows for all time", () => {
  // "Now" is 2026-10-30, so a 30-day period starts on 2026-09-30 (inclusive).
  const rows = [{ date: "2026-10-30" }, { date: "2026-10-01" }, { date: "2026-09-30" }, { date: "2026-09-29" }, { date: "2025-01-01" }];

  assert.deepEqual(plain(loadTrends({ range: "30" }).inRange(rows)).map(row => row.date),
    ["2026-10-30", "2026-10-01", "2026-09-30"]);
  assert.equal(loadTrends({ range: "0" }).inRange(rows).length, 5);
  assert.equal(loadTrends({ range: "365" }).inRange(rows).length, 4);
});

test("durations format as m:ss, then h:mm:ss, rounding to whole seconds and dashing non-numbers", () => {
  const { formatDuration } = loadTrends();

  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(59.6), "1:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3661), "1:01:01");
  assert.equal(formatDuration(NaN), "–");
  assert.equal(formatDuration(undefined), "–");
});

test("averages and number formatting handle empty and non-finite input", () => {
  const { calculateAverage, formatNumber } = loadTrends();

  assert.ok(Number.isNaN(calculateAverage([])));
  assert.equal(calculateAverage([1, 2, 6]), 3);
  assert.equal(formatNumber(3.14159), "3.1");
  assert.equal(formatNumber(3.14159, 0), "3");
  assert.equal(formatNumber(NaN), "–");
});

test("grouping preserves first-seen key order and item order within a group", () => {
  const { groupBy } = loadTrends();
  const groups = groupBy([{ k: "b", n: 1 }, { k: "a", n: 2 }, { k: "b", n: 3 }], item => item.k);

  assert.deepEqual([...groups.keys()], ["b", "a"]);
  assert.deepEqual(plain(groups.get("b")).map(item => item.n), [1, 3]);
});

test("category measurements (energy, mood) map to their position and show the raw label", () => {
  const { measurementMetricValue, formatMeasurementValue } = loadTrends();

  assert.equal(measurementMetricValue({ energy: "spent" }, "energy"), 1);
  assert.equal(measurementMetricValue({ energy: "strong" }, "energy"), 6);
  assert.ok(Number.isNaN(measurementMetricValue({ energy: "" }, "energy")));
  assert.equal(formatMeasurementValue({ mood: "great" }, "mood"), "great");
  assert.equal(formatMeasurementValue({ mood: "" }, "mood"), "–");
  assert.equal(formatMeasurementValue({ weightKg: 81.25 }, "weightKg"), "81.3 kg");
  assert.equal(formatMeasurementValue({ weightKg: null }, "weightKg"), "–");
});

// ---------- charts ----------
// Value labels sit on the y-axis (text-anchor "end"); the last date label is also end-anchored, so drop dates.
const axisLabels = chart => [...String(chart).matchAll(/text-anchor="end">([^<]+)</g)].map(match => match[1])
  .filter(label => !/^\d{4}-\d{2}-\d{2}$/.test(label));
const numericDefinition = { label: "Reps", format: value => String(Math.round(value * 100) / 100) };
const point = (date, value) => ({ date, value });

test("a numeric chart pads its axis by 10% of the data range above and below", () => {
  const { lineChart } = loadTrends();
  const labels = axisLabels(lineChart([point("2026-10-01", 100), point("2026-10-08", 120)], numericDefinition));

  assert.equal(labels[0], "98");
  assert.equal(labels[labels.length - 1], "122");
});

test("a flat series is padded by 10% of its value; all-zero data pads by one", () => {
  const { lineChart } = loadTrends();
  const flat = axisLabels(lineChart([point("2026-10-01", 50), point("2026-10-08", 50)], numericDefinition));
  const zero = axisLabels(lineChart([point("2026-10-01", 0), point("2026-10-08", 0)], numericDefinition));

  assert.deepEqual([flat[0], flat[flat.length - 1]], ["45", "55"]);
  assert.deepEqual([zero[0], zero[zero.length - 1]], ["0", "1"]);
});

test("non-negative data never produces a negative axis, but negative data may go below zero", () => {
  const { lineChart } = loadTrends();
  const nearZero = axisLabels(lineChart([point("2026-10-01", 1), point("2026-10-08", 100)], numericDefinition));
  const negative = axisLabels(lineChart([point("2026-10-01", -10), point("2026-10-08", 10)], numericDefinition));

  assert.equal(nearZero[0], "0");
  assert.equal(negative[0], "-12");
});

test("category charts keep a fixed axis with one gridline per category", () => {
  const { lineChart } = loadTrends();
  const categories = ["bad", "poor", "meh"];
  const chart = String(lineChart([point("2026-10-01", 1), point("2026-10-08", 3)], {
    label: "Mood", categories, format: value => categories[Math.round(value) - 1]
  }));

  assert.deepEqual(axisLabels(chart), categories);
});

test("every point becomes a circle with a date and value tooltip, and empty data shows a message", () => {
  const { lineChart } = loadTrends();
  const chart = String(lineChart([point("2026-10-01", 5), point("2026-10-08", 7), point("2026-10-15", 6)], numericDefinition));

  assert.equal((chart.match(/<circle /g) || []).length, 3);
  assert.match(chart, /<title>2026-10-08: 7<\/title>/);
  assert.match(String(lineChart([], numericDefinition)), /No data for this metric/);
});

test("chart text is escaped, and the accessible description gives span, latest, lowest and highest", () => {
  const { lineChart, describeChart } = loadTrends();
  const hostile = { label: `<img src=x onerror=alert(1)>`, format: value => `v<${value}>` };
  const chart = String(lineChart([point("2026-10-01", 1), point("2026-10-02", 2)], hostile));

  assert.doesNotMatch(chart, /<img/);
  assert.match(chart, /&lt;img/);
  assert.equal(describeChart([point("2026-10-01", 5), point("2026-10-09", 3), point("2026-10-20", 4)], numericDefinition),
    "Reps over time: 3 data points from 2026-10-01 to 2026-10-20. Latest 4, lowest 3, highest 5.");
  assert.match(describeChart([point("2026-10-01", 5)], numericDefinition), /1 data point on 2026-10-01\./);
});
