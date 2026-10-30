// Pure scheduling rules shared by the workout suggestions: which routines a plan schedules on a date, and which of
// them are still worth suggesting. A plan repeats its cycle indefinitely after its start date (see docs/plan.md).
(() => {
  "use strict";

  const MILLISECONDS_PER_DAY = 86400000;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  // Scheduled workouts from up to this many days before the chosen date are still offered if they were missed.
  const OVERDUE_LOOKBACK_DAYS = 2;
  // A workout logged within this many days of its scheduled day counts as done.
  const LOGGED_TOLERANCE_DAYS = 1;

  function toDayNumber(dateString) {
    if (typeof dateString !== "string" || !DATE_PATTERN.test(dateString)) {
      return NaN;
    }

    const milliseconds = Date.parse(`${dateString}T00:00:00Z`);

    return Number.isFinite(milliseconds) ? Math.round(milliseconds / MILLISECONDS_PER_DAY) : NaN;
  }

  function fromDayNumber(dayNumber) {
    return new Date(dayNumber * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
  }

  function cycleLength(plan) {
    const duration = Number(plan?.duration);

    if (!Number.isSafeInteger(duration) || duration < 1) {
      return NaN;
    }

    return duration * (plan.unit === "weeks" ? 7 : 1);
  }

  function routinesOnDate(plan, dateString) {
    const length = cycleLength(plan);
    const daysSinceStart = toDayNumber(dateString) - toDayNumber(plan?.startDate);

    if (!Number.isFinite(length) || !Number.isFinite(daysSinceStart) || daysSinceStart < 0) {
      return [];
    }

    const routines = plan.routines?.[(daysSinceStart % length) + 1];

    return Array.isArray(routines) ? routines : [];
  }

  function wasLoggedNear(loggedWorkouts, routine, scheduledDate, tolerance = LOGGED_TOLERANCE_DAYS) {
    const scheduledDay = toDayNumber(scheduledDate);
    const routineKey = String(routine).trim().toLowerCase();

    return loggedWorkouts.some(workout => String(workout?.routine ?? "").trim().toLowerCase() === routineKey &&
      Math.abs(toDayNumber(workout.date) - scheduledDay) <= tolerance);
  }

  // Returns { state, suggestions }. State is "not-started", "nothing-scheduled", "all-logged" or "suggestions".
  // Each suggestion is { routine, scheduledDate, overdue }; today's workouts come first, a routine is listed once.
  function suggest(plan, dateString, loggedWorkouts = []) {
    const chosenDay = toDayNumber(dateString);
    const startDay = toDayNumber(plan?.startDate);

    if (!Number.isFinite(chosenDay) || !Number.isFinite(startDay) || !Number.isFinite(cycleLength(plan))) {
      return { state: "nothing-scheduled", suggestions: [] };
    }

    if (chosenDay < startDay) {
      return { state: "not-started", suggestions: [] };
    }

    const suggestions = [];
    const seenRoutines = new Set();
    let anyScheduled = false;

    for (let offset = 0; offset <= OVERDUE_LOOKBACK_DAYS; offset += 1) {
      const scheduledDate = fromDayNumber(chosenDay - offset);

      for (const routine of routinesOnDate(plan, scheduledDate)) {
        anyScheduled = true;
        const routineKey = routine.trim().toLowerCase();

        if (seenRoutines.has(routineKey) || wasLoggedNear(loggedWorkouts, routine, scheduledDate)) {
          continue;
        }

        seenRoutines.add(routineKey);
        suggestions.push({ routine, scheduledDate, overdue: offset > 0 });
      }
    }

    if (suggestions.length) {
      return { state: "suggestions", suggestions };
    }

    return { state: anyScheduled ? "all-logged" : "nothing-scheduled", suggestions };
  }

  window.WorkoutPlanSchedule = {
    OVERDUE_LOOKBACK_DAYS, LOGGED_TOLERANCE_DAYS, toDayNumber, routinesOnDate, wasLoggedNear, suggest
  };
})();
