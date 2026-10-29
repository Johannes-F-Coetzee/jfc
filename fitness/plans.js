(() => {
  "use strict";

  const CONFIGURATION = window.WORKOUT_CONFIG?.planForm || {};
  const PENDING_STORAGE_KEY = "plan.pendingSnapshot";
  const QUESTION_FIELD_NAMES = {
    "email": "email",
    "plan id": "planId",
    "plan name": "planName",
    "cycle duration": "duration",
    "duration unit (days/weeks)": "durationUnit",
    "start date": "startDate",
    "total routines": "totalRoutines",
    "routine order": "routineOrder",
    "cycle day": "cycleDay",
    "routine": "routine"
  };
  const REQUIRED_FIELDS = Object.values(QUESTION_FIELD_NAMES);
  const METADATA_FIELDS = [
    "email", "planId", "planName", "duration", "durationUnit", "startDate", "totalRoutines"
  ];

  function isConfigured() {
    return Boolean(CONFIGURATION.formId) && WorkoutForms.hasSubmissionConfiguration(CONFIGURATION, {
      requiredFields: REQUIRED_FIELDS, uniqueEntries: true
    });
  }

  function positiveInteger(value, label) {
    const number = Number(value);

    if (!Number.isSafeInteger(number) || number < 1) {
      throw new Error(`Invalid ${label}.`);
    }

    return number;
  }

  function totalDays(duration, unit, startDate) {
    const days = positiveInteger(duration, "cycle duration") * (unit === "weeks" ? 7 : 1);
    const date = typeof startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ?
      new Date(`${startDate}T00:00:00Z`) : new Date(NaN);
    const endDate = new Date(date.getTime() + (days - 1) * 86400000);

    if (!["days", "weeks"].includes(unit) || !Number.isSafeInteger(days) ||
        !Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 ||
        date.toISOString().slice(0, 10) !== startDate ||
        (unit === "weeks" && date.getUTCDay() !== 1) ||
        !Number.isFinite(endDate.getTime()) || endDate.getUTCFullYear() > 9999) {
      throw new Error("Invalid cycle dates or duration. Weekly plans must start on Monday.");
    }

    return days;
  }

  function assemblePlan(rows) {
    const first = rows[0];
    const expectedCount = positiveInteger(first.totalRoutines, "total routines");
    const days = totalDays(first.duration, first.durationUnit, first.startDate);
    const routines = {};
    const positions = new Set();

    if (!first.planName || !first.email || rows.length !== expectedCount) {
      throw new Error("Incomplete plan snapshot.");
    }

    for (const row of rows) {
      if (METADATA_FIELDS.some(field => row[field] !== first[field])) {
        throw new Error("Inconsistent plan details.");
      }

      const position = positiveInteger(row.routineOrder, "routine order");
      const dayNumber = positiveInteger(row.cycleDay, "cycle day");

      if (!row.routine || dayNumber > days || position > expectedCount || positions.has(position)) {
        throw new Error("Invalid routine, cycle day, or duplicate routine order.");
      }

      positions.add(position);

      if (!routines[dayNumber]) {
        routines[dayNumber] = [];
      }

      if (routines[dayNumber].includes(row.routine)) {
        throw new Error("Duplicate routine on the same cycle day.");
      }

      routines[dayNumber].push(row.routine);
    }

    return {
      name: first.planName,
      duration: Number(first.duration),
      unit: first.durationUnit,
      startDate: first.startDate,
      routines
    };
  }

  async function load() {
    const owner = WorkoutAuth.user;

    if (!owner) {
      throw new Error("Sign in before loading or saving plans.");
    }

    if (!isConfigured()) {
      throw new Error("Set up planForm in fitness/config.js using createWorkoutPlanForm.");
    }

    const { responses, questionMap } = await WorkoutForms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, {
      requiredFields: REQUIRED_FIELDS,
      missingFieldsMessage: "The plan form is missing required questions. Check planForm.fields."
    });

    if (WorkoutAuth.user !== owner) {
      throw new Error("The signed-in account changed.");
    }

    const rows = responses.map(response => Object.fromEntries(
      Object.entries(WorkoutForms.decodeResponse(response, questionMap))
        .map(([field, value]) => [field, value.trim()])
    )).filter(row => row.email?.toLowerCase() === owner.email.toLowerCase());
    const groups = new Map();
    const names = new Map();
    const plans = new Map();
    const warnings = [];

    for (const row of rows) {
      if (row.planName) {
        const name = row.planName.toLowerCase();

        if (!names.has(name)) {
          names.set(name, new Set());
        }

        names.get(name).add(row.planId || "(missing plan ID)");
      }

      if (!row.planName || !row.planId) {
        warnings.push("A plan response is missing its name or plan ID.");
        continue;
      }

      if (!groups.has(row.planId)) {
        groups.set(row.planId, []);
      }

      groups.get(row.planId).push(row);
    }

    for (const [planId, planRows] of groups) {
      const name = planRows[0].planName;

      try {
        if (names.get(name.toLowerCase()).size > 1) {
          throw new Error("Multiple snapshots use this name. Resolve the conflict in Google Forms.");
        }

        const orderedRows = [...planRows].sort((first, second) =>
          Number(first.routineOrder) - Number(second.routineOrder));
        plans.set(planId, assemblePlan(orderedRows));
      } catch (error) {
        warnings.push(`"${name}" is unavailable: ${error.message}`);
      }
    }

    return { plans, names, rows, warnings };
  }

  function planRows(plan, email, planId) {
    if (typeof plan.name !== "string" || !plan.name.trim() ||
        !plan.routines || typeof plan.routines !== "object" || Array.isArray(plan.routines)) {
      throw new Error("Apply plan details and add at least one routine before saving.");
    }

    totalDays(plan.duration, plan.unit, plan.startDate);
    const rows = [];

    for (const [day, routines] of Object.entries(plan.routines).sort(([first], [second]) =>
      Number(first) - Number(second))) {
      if (String(positiveInteger(day, "cycle day")) !== day || !Array.isArray(routines)) {
        throw new Error("Invalid cycle day or routines.");
      }

      for (const routine of routines) {
        if (typeof routine !== "string" || !routine.trim()) {
          throw new Error("Invalid routine name.");
        }

        rows.push({
          email, planId, planName: plan.name.trim(), duration: plan.duration,
          durationUnit: plan.unit, startDate: plan.startDate,
          cycleDay: day, routine, routineOrder: rows.length + 1
        });
      }
    }

    if (!rows.length) {
      throw new Error("Add at least one routine before saving a plan to Google Forms.");
    }

    const completedRows = rows.map(row => Object.fromEntries(Object.entries({
      ...row, totalRoutines: rows.length
    }).map(([field, value]) => [field, String(value)])));
    assemblePlan(completedRows);

    return completedRows;
  }

  async function save(plan) {
    const owner = WorkoutAuth.user;

    if (!owner) {
      throw new Error("Sign in before saving a plan.");
    }

    const expectedRows = planRows(plan, owner.email, "");
    const fingerprint = JSON.stringify(expectedRows);
    const pendingKey = `${PENDING_STORAGE_KEY}:${owner.email}:${plan.name.trim().toLowerCase()}`;
    const storedPending = localStorage.getItem(pendingKey);
    const pending = storedPending ? JSON.parse(storedPending) : null;
    const planId = pending?.fingerprint === fingerprint ? pending.planId : crypto.randomUUID();

    if (typeof planId !== "string" || !planId) {
      throw new Error("Invalid pending plan ID. Check this device's pending plan data.");
    }

    const rows = expectedRows.map(row => ({ ...row, planId }));
    const assertOwner = () => {
      if (WorkoutAuth.user !== owner) {
        throw new Error("The signed-in account changed.");
      }
    };
    const assertMatchingRows = catalog => {
      const existingRows = catalog.rows.filter(row => row.planId === planId);
      const confirmed = new Set();

      for (const row of existingRows) {
        const expected = rows[Number(row.routineOrder) - 1];

        if (!expected || confirmed.has(row.routineOrder) ||
            REQUIRED_FIELDS.some(field => row[field] !== expected[field])) {
          throw new Error("Stored rows conflict with this pending snapshot. Resolve the conflict in Google Forms.");
        }

        confirmed.add(row.routineOrder);
      }

      return confirmed;
    };
    const catalog = await load();
    assertOwner();
    const existing = catalog.names.get(plan.name.trim().toLowerCase());

    if (existing && [...existing].some(identifier => identifier !== planId)) {
      throw new Error("A plan with this name already exists for your account. Choose a new name; snapshots cannot be overwritten.");
    }

    const confirmed = assertMatchingRows(catalog);
    localStorage.setItem(pendingKey, JSON.stringify({ fingerprint, planId }));

    try {
      for (const row of rows) {
        assertOwner();

        if (!confirmed.has(row.routineOrder)) {
          await WorkoutForms.postRow(CONFIGURATION, row);
        }
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const updated = await load();
        assertOwner();
        assertMatchingRows(updated);

        if (updated.plans.has(planId)) {
          localStorage.removeItem(pendingKey);

          return updated;
        }

        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      throw new Error("Not all routine rows could be read back. Check that the form is published and accepting anonymous responses.");
    } catch (error) {
      throw new Error(`${error.message} Save was not confirmed. Retry with the same name and unchanged routines to resume missing rows.`);
    }
  }

  window.WorkoutPlans = { isConfigured, load, save };
})();
