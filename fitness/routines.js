(() => {
  "use strict";

  const CONFIGURATION = window.WORKOUT_CONFIG?.configurationForm || {};
  const PENDING_STORAGE_KEY = "workout.pendingConfiguration";
  const SESSION_ACCESS_TOKEN_KEY = "workout.formsToken";
  const LEGACY_SESSION_ACCESS_TOKEN_KEY = "workout.trendsToken";
  const QUESTION_FIELD_NAMES = {
    "email": "email", "configuration id": "configurationId", "routine": "routine",
    "total sets": "totalSets", "estimated time (seconds)": "estimatedSeconds",
    "exercise": "exercise", "exercise order": "exerciseOrder", "set number": "setNumber",
    "measure (reps/time)": "measure", "reps": "reps", "duration (seconds)": "durationSeconds",
    "weight (kg)": "weightKg"
  };
  let accessToken = null;
  let tokenEmail = "";
  let tokenExpiresAt = 0;

  function isConfigured() {
    return Boolean(CONFIGURATION.formId) &&
      /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(CONFIGURATION.actionUrl || "") &&
      Object.values(QUESTION_FIELD_NAMES).every(field => /^entry\.\d+$/.test(CONFIGURATION.fields?.[field] || ""));
  }

  function hasCachedToken() {
    try {
      const cachedAccessToken = JSON.parse(
        sessionStorage.getItem(SESSION_ACCESS_TOKEN_KEY) ||
        sessionStorage.getItem(LEGACY_SESSION_ACCESS_TOKEN_KEY) ||
        "null"
      );

      return cachedAccessToken?.email === WorkoutAuth.user?.email &&
        cachedAccessToken.expiresAt > Date.now() + 60000;
    } catch {
      return false;
    }
  }

  function clearCachedToken() {
    accessToken = null;
    tokenEmail = "";
    tokenExpiresAt = 0;
    sessionStorage.removeItem(SESSION_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);
  }

  async function getToken() {
    if (!WorkoutAuth.user) {
      throw new Error("Sign in before loading or saving configurations.");
    }

    if (!isConfigured()) {
      throw new Error("Set up configurationForm in fitness/config.js using createWorkoutConfigurationForm.");
    }

    try {
      const cachedAccessToken = JSON.parse(
        sessionStorage.getItem(SESSION_ACCESS_TOKEN_KEY) ||
        sessionStorage.getItem(LEGACY_SESSION_ACCESS_TOKEN_KEY) ||
        "null"
      );

      if (cachedAccessToken?.email === WorkoutAuth.user.email &&
          cachedAccessToken.expiresAt > Date.now() + 60000) {
        accessToken = cachedAccessToken.token;
        tokenEmail = cachedAccessToken.email;
        tokenExpiresAt = cachedAccessToken.expiresAt;
        sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, JSON.stringify(cachedAccessToken));
        sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);
      }
    } catch {
      sessionStorage.removeItem(SESSION_ACCESS_TOKEN_KEY);
    }

    if (!accessToken || tokenEmail !== WorkoutAuth.user.email || tokenExpiresAt <= Date.now()) {
      accessToken = await WorkoutAuth.requestAccessToken(WorkoutForms.READ_PERMISSIONS);
      tokenEmail = WorkoutAuth.user.email;
      tokenExpiresAt = Date.now() + 55 * 60000;
      sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, JSON.stringify({
        token: accessToken,
        email: tokenEmail,
        expiresAt: tokenExpiresAt
      }));
    }

    return accessToken;
  }

  function numberField(value, label, integer = false) {
    const number = Number(value);

    if (value === undefined || value === "" || !Number.isFinite(number) || number < 0 ||
        (integer && (!Number.isInteger(number) || number < 1))) {
      throw new Error(`Invalid ${label}.`);
    }

    return number;
  }

  function decodeResponses(responses, questionMap) {
    return responses.map(response => {
      const row = {};
      Object.entries(response.answers || {}).forEach(([questionId, answer]) => {
        const field = questionMap.get(questionId);

        if (field) {
          row[field] = (answer.textAnswers?.answers?.[0]?.value || "").trim();
        }
      });

      return row;
    });
  }

  function assembleRoutine(rows) {
    const first = rows[0];
    const totalSets = numberField(first.totalSets, "total sets", true);
    const estimatedSeconds = numberField(first.estimatedSeconds, "estimated time");
    const exercises = new Map();

    if (!first.email || rows.length !== totalSets) {
      throw new Error("Incomplete configuration.");
    }

    for (const row of rows) {
      if (row.routine !== first.routine || row.email !== first.email ||
          row.totalSets !== first.totalSets || row.estimatedSeconds !== first.estimatedSeconds) {
        throw new Error("Inconsistent configuration metadata.");
      }

      const exerciseOrder = numberField(row.exerciseOrder, "exercise order", true);
      const setNumber = numberField(row.setNumber, "set number", true);

      if (!row.exercise || !["reps", "time"].includes(row.measure)) {
        throw new Error("Invalid exercise or measure.");
      }

      if (!exercises.has(exerciseOrder)) {
        exercises.set(exerciseOrder, { name: row.exercise, measure: row.measure, sets: new Map() });
      }

      const exercise = exercises.get(exerciseOrder);

      if (exercise.name !== row.exercise || exercise.measure !== row.measure || exercise.sets.has(setNumber)) {
        throw new Error("Conflicting exercise or duplicate set.");
      }

      const field = row.measure === "time" ? "durationSeconds" : "reps";
      const set = { [field]: numberField(row[field], field) };

      if (row.weightKg !== undefined && row.weightKg !== "") {
        set.weightKg = numberField(row.weightKg, "weight");
      }

      exercise.sets.set(setNumber, set);
    }

    const ordered = collection => [...collection.entries()].sort(([firstOrder], [secondOrder]) => firstOrder - secondOrder)
      .map(([order, value], index) => {
        if (order !== index + 1) {
          throw new Error("Missing exercise or set.");
        }

        return value;
      });

    return {
      name: first.routine,
      savedBy: first.email,
      estimatedSeconds,
      configurationId: first.configurationId,
      exercises: ordered(exercises).map(exercise => ({
        name: exercise.name, measure: exercise.measure, sets: ordered(exercise.sets)
      }))
    };
  }

  function buildCatalog(rows) {
    const groups = new Map();
    const names = new Map();
    const warnings = [];
    const routines = new Map();

    for (const row of rows) {
      if (row.routine) {
        const nameKey = row.routine.toLowerCase();

        if (!names.has(nameKey)) {
          names.set(nameKey, new Set());
        }

        names.get(nameKey).add(row.configurationId || "(missing configuration ID)");
      }

      if (!row.routine || !row.configurationId) {
        warnings.push("A response is missing its workout name or configuration ID.");
        continue;
      }

      if (!groups.has(row.configurationId)) {
        groups.set(row.configurationId, []);
      }

      groups.get(row.configurationId).push(row);
    }

    for (const configurationRows of groups.values()) {
      const name = configurationRows[0].routine;

      try {
        if (names.get(name.toLowerCase()).size > 1) {
          throw new Error("Multiple configurations use this name; resolve the conflict in Google Forms.");
        }

        const routine = assembleRoutine(configurationRows);
        routines.set(routine.name, routine);
      } catch (error) {
        warnings.push(`"${name}" is unavailable: ${error.message}`);
      }
    }

    return { routines, names, rows, warnings };
  }

  async function load() {
    try {
      const token = await getToken();
      const definition = await WorkoutForms.fetchResource(encodeURIComponent(CONFIGURATION.formId), token);
      const questionMap = WorkoutForms.buildQuestionMap(CONFIGURATION, definition, QUESTION_FIELD_NAMES);

      if (!Object.values(QUESTION_FIELD_NAMES).every(field => [...questionMap.values()].includes(field))) {
        throw new Error("The configuration form is missing required questions. Check configurationForm.fields.");
      }

      const responses = await WorkoutForms.fetchAllResponses(CONFIGURATION, token);

      return buildCatalog(decodeResponses(responses, questionMap));
    } catch (error) {
      if (error instanceof WorkoutForms.RequestError) {
        if (error.status === 401) {
          accessToken = null;
          sessionStorage.removeItem(SESSION_ACCESS_TOKEN_KEY);
        }

        throw new Error(`Could not read the configuration form: ${error.message}. ` +
          "Every tracker user needs edit access to this form, and the Google Forms API must be enabled.");
      }

      throw error;
    }
  }

  async function save(routine, estimatedSeconds) {
    const email = WorkoutAuth.user?.email;

    if (!email || !routine.name?.trim() || !routine.exercises?.length) {
      throw new Error("Sign in and provide a workout name and at least one exercise before saving.");
    }

    routine = { ...routine, name: routine.name.trim() };
    const fingerprint = JSON.stringify({ routine, estimatedSeconds, email });
    const pendingStorageKey = `${PENDING_STORAGE_KEY}:${email}:${routine.name.toLowerCase()}`;
    const storedPending = localStorage.getItem(pendingStorageKey);
    const pending = storedPending ? JSON.parse(storedPending) : null;
    const configurationId = pending?.fingerprint === fingerprint ? pending.configurationId : crypto.randomUUID();
    const catalog = await load();
    const existing = catalog.names.get(routine.name.toLowerCase());

    if (existing && [...existing].some(identifier => identifier !== configurationId)) {
      throw new Error(`A configuration named "${routine.name}" already exists. Choose a unique name; saved configurations cannot be overwritten.`);
    }

    const rows = [];
    const totalSets = routine.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    routine.exercises.forEach((exercise, exerciseIndex) => {
      exercise.sets.forEach((set, setIndex) => rows.push({
        ...set, email, configurationId, routine: routine.name, totalSets, estimatedSeconds,
        exercise: exercise.name, exerciseOrder: exerciseIndex + 1, setNumber: setIndex + 1, measure: exercise.measure
      }));
    });
    assembleRoutine(rows);
    localStorage.setItem(pendingStorageKey, JSON.stringify({ fingerprint, configurationId }));
    const confirmedSets = new Set(catalog.rows.filter(row => row.configurationId === configurationId)
      .map(row => `${row.exerciseOrder}:${row.setNumber}`));

    try {
      for (const row of rows) {
        if (!WorkoutAuth.user || WorkoutAuth.user.email !== email) {
          throw new Error("The signed-in account changed.");
        }

        if (!confirmedSets.has(`${row.exerciseOrder}:${row.setNumber}`)) {
          await WorkoutForms.postRow(CONFIGURATION, row);
        }
      }

      // Public form POSTs cannot confirm success. Only report success after reading every set back.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const updated = await load();
        const saved = updated.routines.get(routine.name);

        if (saved?.configurationId === configurationId) {
          localStorage.removeItem(pendingStorageKey);

          return updated;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      throw new Error("Not all sets could be confirmed in the form. Check that the form is published and accepting anonymous responses.");
    } catch (error) {
      throw new Error(`${error.message} Save was not confirmed. Retry with this same name and unchanged sets to resume missing sets.`);
    }
  }

  window.WorkoutRoutines = { isConfigured, hasCachedToken, clearCachedToken, load, save };
})();
