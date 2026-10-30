const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadInternals } = require("./helpers.cjs");

const plan = (overrides = {}) => ({
  name: "Block", duration: 2, unit: "weeks", startDate: "2026-10-26", routines: {}, ...overrides
});
const iso = date => date.toISOString().slice(0, 10);
const load = () => loadInternals("plan.js", [
  "parseDate", "addDays", "cycleDays", "cycleStart", "cycleEnd", "defaultStartDate", "validatePlan", "emptyPlan"
]);

test("dates must be real calendar dates in YYYY-MM-DD form", () => {
  const { parseDate } = load();

  assert.equal(iso(parseDate("2026-10-30")), "2026-10-30");
  assert.equal(iso(parseDate("2028-02-29")), "2028-02-29");
  for (const invalid of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-1", "30/10/2026", "", null, undefined, 20261030]) {
    assert.equal(parseDate(invalid), null, String(invalid));
  }
});

test("adding days is calendar-exact across months, leap years and clock changes", () => {
  const { parseDate, addDays } = load();

  assert.equal(iso(addDays(parseDate("2026-10-30"), 3)), "2026-11-02");
  assert.equal(iso(addDays(parseDate("2028-02-28"), 1)), "2028-02-29");
  assert.equal(iso(addDays(parseDate("2026-03-28"), 2)), "2026-03-30");
  assert.equal(iso(addDays(parseDate("2026-10-24"), 2)), "2026-10-26");
  assert.equal(iso(addDays(parseDate("2026-01-01"), -1)), "2025-12-31");
});

test("a cycle's length is its duration in days, or seven days per week", () => {
  const { cycleDays } = load();

  assert.equal(cycleDays(plan({ duration: 3, unit: "weeks" })), 21);
  assert.equal(cycleDays(plan({ duration: 10, unit: "days" })), 10);
});

test("a cycle ends on its last day, inclusive", () => {
  const { cycleStart, cycleEnd } = load();

  assert.equal(iso(cycleStart(plan())), "2026-10-26");
  assert.equal(iso(cycleEnd(plan({ duration: 2, unit: "weeks" }))), "2026-11-08");
  assert.equal(iso(cycleEnd(plan({ duration: 1, unit: "days", startDate: "2026-10-30" }))), "2026-10-30");
  assert.equal(iso(cycleEnd(plan({ duration: 3, unit: "days", startDate: "2026-12-30" }))), "2027-01-01");
});

test("the default start is today for day cycles and the next Monday (never today) for week cycles", () => {
  const { defaultStartDate, parseDate } = load();
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const weekly = parseDate(defaultStartDate("weeks"));

  assert.equal(defaultStartDate("days"), todayIso);
  assert.equal(weekly.getUTCDay(), 1);
  assert.ok(weekly > parseDate(todayIso));
  assert.ok(weekly - parseDate(todayIso) <= 7 * 86400000);
});

test("a new plan defaults to four weeks starting on a Monday with no routines", () => {
  const { emptyPlan, parseDate } = load();
  const fresh = emptyPlan();

  assert.equal(fresh.name, "");
  assert.equal(fresh.duration, 4);
  assert.equal(fresh.unit, "weeks");
  assert.equal(parseDate(fresh.startDate).getUTCDay(), 1);
  assert.equal(Object.keys(fresh.routines).length, 0);
});

test("a well-formed plan validates, including routines on the first and last day", () => {
  const { validatePlan } = load();

  assert.doesNotThrow(() => validatePlan(plan({ routines: { 1: ["Push"], 14: ["Pull", "Legs"] } })));
  assert.doesNotThrow(() => validatePlan(plan({ unit: "days", duration: 5, startDate: "2026-10-28", routines: { 5: ["Push"] } })));
});

test("invalid plan details are rejected", () => {
  const { validatePlan } = load();

  for (const invalid of [
    null, plan({ name: "" }), plan({ name: "   " }), plan({ unit: "months" }), plan({ duration: 0 }),
    plan({ duration: 1.5 }), plan({ duration: "2" }), plan({ routines: null }), plan({ routines: [] })
  ]) {
    assert.throws(() => validatePlan(invalid), /invalid details/, JSON.stringify(invalid));
  }
});

test("week cycles must start on a Monday, and the start date must be real", () => {
  const { validatePlan } = load();

  assert.throws(() => validatePlan(plan({ startDate: "2026-10-27" })), /Monday/);
  assert.throws(() => validatePlan(plan({ unit: "days", startDate: "2026-02-30" })), /valid start date/);
  assert.doesNotThrow(() => validatePlan(plan({ unit: "days", startDate: "2026-10-27" })));
});

test("routine entries must sit on a real cycle day, be non-empty and unique per day", () => {
  const { validatePlan } = load();

  for (const routines of [
    { 0: ["Push"] }, { 15: ["Push"] }, { "01": ["Push"] }, { 1.5: ["Push"] }, { abc: ["Push"] },
    { 1: "Push" }, { 1: [""] }, { 1: [" "] }, { 1: [3] }, { 1: ["Push", "Push"] }
  ]) {
    assert.throws(() => validatePlan(plan({ routines })), /invalid routine entries/, JSON.stringify(routines));
  }
});

test("a cycle cannot run past the year 9999", () => {
  const { validatePlan } = load();

  assert.throws(() => validatePlan(plan({ unit: "days", duration: 400, startDate: "9999-06-01" })), /9999/);
});
