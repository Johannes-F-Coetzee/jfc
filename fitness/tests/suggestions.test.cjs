const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { loadUtilities, readSource, settle } = require("./helpers.cjs");

const plain = value => JSON.parse(JSON.stringify(value));

function loadSchedule() {
  const window = {};
  runInNewContext(readSource("plan-schedule.js"), { window });

  return window.WorkoutPlanSchedule;
}

// Mondays: 2026-11-02 and 2026-11-09. Cycle day 1 is Monday.
const WEEKLY_PLAN = {
  name: "Strength", duration: 1, unit: "weeks", startDate: "2026-11-02",
  routines: { 1: ["Push"], 3: ["Pull", "Core"], 5: ["Legs"] }
};

test("a plan schedules its routines by cycle day and repeats after the cycle ends", () => {
  const { routinesOnDate } = loadSchedule();

  assert.deepEqual(plain(routinesOnDate(WEEKLY_PLAN, "2026-11-02")), ["Push"]);
  assert.deepEqual(plain(routinesOnDate(WEEKLY_PLAN, "2026-11-04")), ["Pull", "Core"]);
  assert.deepEqual(plain(routinesOnDate(WEEKLY_PLAN, "2026-11-03")), []);
  assert.deepEqual(plain(routinesOnDate(WEEKLY_PLAN, "2026-11-09")), ["Push"]);
  assert.deepEqual(plain(routinesOnDate(WEEKLY_PLAN, "2026-11-13")), ["Legs"]);
  assert.deepEqual(plain(routinesOnDate(WEEKLY_PLAN, "2026-11-01")), []);
  assert.deepEqual(plain(routinesOnDate({ ...WEEKLY_PLAN, startDate: "bad" }, "2026-11-02")), []);
  assert.deepEqual(plain(routinesOnDate({ ...WEEKLY_PLAN, duration: 0 }, "2026-11-02")), []);
});

test("day-based cycles repeat after their length", () => {
  const { routinesOnDate } = loadSchedule();
  const plan = { name: "Short", duration: 3, unit: "days", startDate: "2026-11-02", routines: { 1: ["A"], 3: ["B"] } };

  assert.deepEqual(plain(routinesOnDate(plan, "2026-11-04")), ["B"]);
  assert.deepEqual(plain(routinesOnDate(plan, "2026-11-05")), ["A"]);
  assert.deepEqual(plain(routinesOnDate(plan, "2026-12-02")), ["A"]);
});

test("today's scheduled workouts come first, followed by recently missed ones", () => {
  const { suggest } = loadSchedule();
  const result = plain(suggest(WEEKLY_PLAN, "2026-11-04", []));

  assert.equal(result.state, "suggestions");
  assert.deepEqual(result.suggestions.map(item => [item.routine, item.scheduledDate, item.overdue]),
    [["Pull", "2026-11-04", false], ["Core", "2026-11-04", false], ["Push", "2026-11-02", true]]);
});

test("a workout logged on, a day before or a day after its scheduled day is not suggested", () => {
  const { suggest } = loadSchedule();

  const dueToday = result => result.suggestions.filter(item => !item.overdue).map(item => item.routine);

  for (const date of ["2026-11-03", "2026-11-04", "2026-11-05"]) {
    assert.deepEqual(dueToday(plain(suggest(WEEKLY_PLAN, "2026-11-04", [{ date, routine: "pull" }]))), ["Core"], date);
  }

  for (const date of ["2026-11-01", "2026-11-06"]) {
    assert.deepEqual(dueToday(plain(suggest(WEEKLY_PLAN, "2026-11-04", [{ date, routine: "Pull" }]))),
      ["Pull", "Core"], date);
  }

  const everything = plain(suggest(WEEKLY_PLAN, "2026-11-04", [
    { date: "2026-11-04", routine: "Pull" }, { date: "2026-11-04", routine: "Core" },
    { date: "2026-11-03", routine: "Push" }
  ]));
  assert.equal(everything.state, "all-logged");
});

test("a recently missed workout is offered as overdue, and drops out once logged close to its day", () => {
  const { suggest } = loadSchedule();
  const missed = plain(suggest(WEEKLY_PLAN, "2026-11-04", []));
  const monday = plain(suggest(WEEKLY_PLAN, "2026-11-03", []));

  assert.deepEqual(monday.suggestions.map(item => [item.routine, item.overdue]), [["Push", true]]);
  assert.equal(missed.suggestions.some(item => item.routine === "Push"), true);
  assert.equal(plain(suggest(WEEKLY_PLAN, "2026-11-03", [{ date: "2026-11-03", routine: "Push" }])).state, "all-logged");
  assert.equal(plain(suggest(WEEKLY_PLAN, "2026-11-06", [])).suggestions.some(item => item.routine === "Push"), false);
});

test("future scheduled workouts, workouts before the start date and rest days are not suggested", () => {
  const { suggest } = loadSchedule();

  assert.equal(plain(suggest(WEEKLY_PLAN, "2026-10-30", [])).state, "not-started");
  assert.equal(plain(suggest(WEEKLY_PLAN, "2026-11-03", [])).suggestions.some(item => item.routine === "Pull"), false);
  assert.equal(plain(suggest({ ...WEEKLY_PLAN, routines: {} }, "2026-11-04", [])).state, "nothing-scheduled");
  assert.equal(plain(suggest(WEEKLY_PLAN, "", [])).state, "nothing-scheduled");
});

test("a routine scheduled on consecutive days is listed once, for the latest date", () => {
  const { suggest } = loadSchedule();
  const plan = { name: "Daily", duration: 1, unit: "weeks", startDate: "2026-11-02", routines: { 1: ["Run"], 2: ["Run"] } };
  const result = plain(suggest(plan, "2026-11-03", []));

  assert.deepEqual(result.suggestions.map(item => [item.routine, item.scheduledDate]), [["Run", "2026-11-03"]]);
});

function loadLogReader({ responses, user = { email: "me@example.com" }, configured = true }) {
  const window = { WORKOUT_CONFIG: { form: configured ? { formId: "form" } : {} } };
  const questionMap = new Map([["q1", "email"], ["q2", "date"], ["q3", "routine"]]);
  const context = {
    window,
    WorkoutAuth: { user },
    WorkoutForms: {
      readForm: async () => ({ responses, questionMap }),
      decodeResponse: (response, map) => Object.fromEntries(Object.entries(response.answers)
        .map(([id, value]) => [map.get(id), value]))
    }
  };
  runInNewContext(readSource("logged-workouts.js"), context);

  return window.WorkoutLog;
}

const response = (email, date, routine, submitted = "2026-11-04T08:00:00Z") => ({
  lastSubmittedTime: submitted, answers: { q1: email, q2: date, q3: routine }
});

test("logged workouts are read for the signed-in account only, once per day and routine", async () => {
  const log = loadLogReader({
    responses: [
      response("me@example.com", "2026-11-04", "Pull"),
      response("ME@example.com", "2026-11-04", " pull "),
      response("other@example.com", "2026-11-04", "Core"),
      response("me@example.com", "", "Legs", "2026-11-05T09:00:00Z"),
      response("me@example.com", "2026-11-06", "")
    ]
  });

  assert.deepEqual(plain(await log.load()), [
    { date: "2026-11-04", routine: "Pull" }, { date: "2026-11-05", routine: "Legs" }
  ]);
});

test("reading logged workouts needs a signed-in account and a configured form", async () => {
  await assert.rejects(loadLogReader({ responses: [], user: null }).load(), /Sign in/);
  await assert.rejects(loadLogReader({ responses: [], configured: false }).load(), /form\.formId/);
  assert.equal(loadLogReader({ responses: [], configured: false }).isConfigured(), false);
});

function loadSuggestionsModule({ plans, loggedLocally = [], loggedRemotely = [], remoteFails = false }) {
  const window = loadUtilities();
  const elements = new Map();
  const storage = new Map();
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        value: "", textContent: "", className: "", disabled: false, events: {},
        addEventListener(name, callback) { this.events[name] = callback; }
      });
    }

    return elements.get(selector);
  };
  const loaded = [];
  const schedule = {};
  runInNewContext(readSource("plan-schedule.js"), { window: schedule });
  const context = {
    window,
    document: { querySelector: element },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    },
    console: { error() {} },
    WorkoutPlanSchedule: schedule.WorkoutPlanSchedule,
    WorkoutPlans: {
      isConfigured: () => true,
      load: async () => ({ plans: new Map(plans.map((plan, index) => [`id-${index}`, plan])), warnings: [] })
    },
    WorkoutLog: {
      isConfigured: () => true,
      load: async () => {
        if (remoteFails) {
          throw new Error("denied");
        }

        return loggedRemotely;
      }
    }
  };
  runInNewContext(readSource("workout-suggestions.js"), context);
  const suggestions = window.WorkoutSuggestions;
  suggestions.init({
    getDate: () => "2026-11-04",
    getLoggedWorkouts: () => loggedLocally,
    hasRoutine: name => name !== "Core",
    loadRoutine: name => loaded.push(name)
  });

  return { suggestions, element, storage, loaded, user: { email: "me@example.com" } };
}

test("signing in loads plans, remembers the chosen plan and suggests what is due", async () => {
  const environment = loadSuggestionsModule({ plans: [WEEKLY_PLAN] });
  environment.suggestions.signedIn(environment.user);
  await settle();

  assert.match(environment.element("#plan-suggestion-status").textContent, /Loaded 1 plan/);
  assert.match(environment.element("#suggestion-list").innerHTML, /Choose a plan/);

  environment.element("#suggestion-plan-select").events.change({ target: { value: "Strength" } });
  const markup = environment.element("#suggestion-list").innerHTML;

  assert.match(markup, /data-routine="Pull"/);
  assert.match(markup, /data-routine="Core"[^>]*disabled/);
  assert.equal(environment.storage.get("workout.activePlan:me@example.com"), "Strength");

  environment.element("#suggestion-list").events.click({
    target: { closest: () => ({ dataset: { routine: "Pull" } }) }
  });
  assert.deepEqual(environment.loaded, ["Pull"]);
});

test("workouts logged on this device or recorded in the form are not suggested", async () => {
  const environment = loadSuggestionsModule({
    plans: [WEEKLY_PLAN],
    loggedLocally: [{ date: "2026-11-04", routine: "Pull" }, { date: "2026-11-02", routine: "Push" }],
    loggedRemotely: [{ date: "2026-11-05", routine: "Core" }]
  });
  environment.storage.set("workout.activePlan:me@example.com", "Strength");
  environment.suggestions.signedIn(environment.user);
  await settle();

  assert.match(environment.element("#suggestion-list").innerHTML, /Everything scheduled around this date is already logged/);
  assert.equal(environment.element("#suggestion-plan-select").value, "Strength");
});

test("when the form cannot be read, suggestions fall back to this device's workouts and say so", async () => {
  const environment = loadSuggestionsModule({
    plans: [WEEKLY_PLAN], loggedLocally: [{ date: "2026-11-04", routine: "Pull" }, { date: "2026-11-02", routine: "Push" }],
    remoteFails: true
  });
  environment.storage.set("workout.activePlan:me@example.com", "Strength");
  environment.suggestions.signedIn(environment.user);
  await settle();

  assert.match(environment.element("#plan-suggestion-status").textContent, /only consider workouts logged on this device/);
  assert.match(environment.element("#suggestion-list").innerHTML, /data-routine="Core"/);
  assert.doesNotMatch(environment.element("#suggestion-list").innerHTML, /data-routine="Pull"/);
});

test("signing out clears the plans and suggestions", async () => {
  const environment = loadSuggestionsModule({ plans: [WEEKLY_PLAN] });
  environment.storage.set("workout.activePlan:me@example.com", "Strength");
  environment.suggestions.signedIn(environment.user);
  await settle();
  environment.suggestions.signedOut();

  assert.equal(environment.element("#refresh-plans").disabled, true);
  assert.equal(environment.element("#plan-suggestion-status").textContent, "");
  assert.doesNotMatch(environment.element("#suggestion-list").innerHTML, /data-routine/);
});
