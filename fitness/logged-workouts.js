// Reads the signed-in account's logged workouts (date and routine) from the workout log form's responses, using the
// same Google Forms pipeline as the routine, plan and trends modules.
(() => {
  "use strict";

  const CONFIGURATION = window.WORKOUT_CONFIG?.form || {};
  const QUESTION_FIELD_NAMES = {
    "email": "email", "workout date": "date", "routine": "routine"
  };
  const REQUIRED_FIELDS = Object.values(QUESTION_FIELD_NAMES);
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function isConfigured() {
    return Boolean(CONFIGURATION.formId);
  }

  // Resolves to one { date, routine } entry per workout day and routine the account has logged.
  async function load() {
    const owner = WorkoutAuth.user;

    if (!owner) {
      throw new Error("Sign in before reading logged workouts.");
    }

    if (!isConfigured()) {
      throw new Error("Set form.formId in fitness/config.js to read logged workouts.");
    }

    const { responses, questionMap } = await WorkoutForms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, {
      requiredFields: REQUIRED_FIELDS,
      missingFieldsMessage: "The workout form is missing the email, date or routine questions.",
      retryUnauthorized: true
    });

    if (WorkoutAuth.user !== owner) {
      throw new Error("The signed-in account changed.");
    }

    const ownerEmail = owner.email.toLowerCase();
    const workouts = new Map();

    for (const response of responses) {
      const row = WorkoutForms.decodeResponse(response, questionMap);
      const submitted = response.lastSubmittedTime || response.createTime || "";
      const date = DATE_PATTERN.test(row.date || "") ? row.date : submitted.slice(0, 10);
      const routine = (row.routine || "").trim();

      const key = `${date}|${routine.toLowerCase()}`;

      if ((row.email || "").trim().toLowerCase() === ownerEmail && DATE_PATTERN.test(date) && routine &&
          !workouts.has(key)) {
        workouts.set(key, { date, routine });
      }
    }

    return [...workouts.values()];
  }

  window.WorkoutLog = { isConfigured, load };
})();
