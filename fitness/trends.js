(() => {
  "use strict";

  const WORKOUT_CONFIGURATION = window.WORKOUT_CONFIG || {};
  const FORM_CONFIGURATION = WORKOUT_CONFIGURATION.form || {};
  const FORMS_READ_PERMISSIONS = WorkoutForms.READ_PERMISSIONS;
  const GOOGLE_FORMS_REQUEST_ERROR = WorkoutForms.RequestError;
  const SESSION_ACCESS_TOKEN_KEY = "workout.formsToken";
  const LEGACY_SESSION_ACCESS_TOKEN_KEY = "workout.trendsToken";
  const SECONDS_PER_REPETITION = 10;
  const REST_SECONDS_BETWEEN_SETS = 60;

  // Question titles used by setup/create-form.gs, for forms whose question IDs don't match the entry IDs.
  const FORM_QUESTION_FIELD_NAMES = {
    "email": "email", "session id": "sessionId", "workout date": "date", "routine": "routine",
    "exercise": "exercise", "exercise order": "exerciseOrder", "set number": "setNumber",
    "measure (reps/time)": "measure", "reps": "reps", "duration (seconds)": "durationSeconds",
    "weight (kg)": "weightKg", "perceived difficulty (rpe 1-10)": "rpe", "set notes": "notes",
    "session notes": "sessionNotes"
  };

  const $ = selector => document.querySelector(selector);

  let rows = [];
  let allRows = [];
  let loadedAt = null;
  let loading = false;

  // ---------- helpers ----------
  function escapeMarkup(text) {
    return String(text ?? "").replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function formatDuration(secondsToFormat) {
    if (!Number.isFinite(secondsToFormat)) {
      return "–";
    }

    const seconds = Math.round(secondsToFormat);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secondsRemaining = String(seconds % 60).padStart(2, "0");

    if (hours) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${secondsRemaining}`;
    }

    return `${minutes}:${secondsRemaining}`;
  }

  const calculateAverage = values => (values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : NaN);
  const formatNumber = (value, decimalPlaces = 1) => (Number.isFinite(value)
    ? String(Math.round(value * 10 ** decimalPlaces) / 10 ** decimalPlaces)
    : "–");

  function setStatus(message, kind = "") {
    const statusElement = $("#trends-status");
    statusElement.textContent = message;
    statusElement.className = `status ${kind}`;
  }

  function showForkHelp(reason) {
    $("#fork-reason").textContent = reason;
    $("#fork-help").hidden = false;
    $("#results").hidden = true;
    $("#trends-empty").hidden = true;
  }

  // ---------- access token ----------
  function cachedToken() {
    try {
      const cachedAccessToken = JSON.parse(
        sessionStorage.getItem(SESSION_ACCESS_TOKEN_KEY) ||
        sessionStorage.getItem(LEGACY_SESSION_ACCESS_TOKEN_KEY) ||
        "null"
      );

      if (cachedAccessToken && cachedAccessToken.email === WorkoutAuth.user?.email &&
          cachedAccessToken.expiresAt > Date.now() + 60000) {
        return cachedAccessToken.token;
      }
    } catch { /* ignore */ }

    return null;
  }

  async function getToken(forceNew) {
    if (!forceNew) {
      const token = cachedToken();

      if (token) {
        return token;
      }
    }

    const token = await WorkoutAuth.requestAccessToken(FORMS_READ_PERMISSIONS);
    // Google sign-in access tokens last one hour.
    sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, JSON.stringify({
      token,
      email: WorkoutAuth.user.email,
      expiresAt: Date.now() + 55 * 60000
    }));
    sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);

    return token;
  }

  async function fetchGoogleFormsResource(path, token) {
    return WorkoutForms.fetchResource(path, token);
  }

  // ---------- reading responses ----------
  function buildQuestionMap(formDefinition) {
    return WorkoutForms.buildQuestionMap(FORM_CONFIGURATION, formDefinition, FORM_QUESTION_FIELD_NAMES);
  }

  async function fetchAllResponses(token) {
    return WorkoutForms.fetchAllResponses(FORM_CONFIGURATION, token);
  }

  function toWorkoutRow(response, questionMap) {
    const row = { submitted: response.lastSubmittedTime || response.createTime };
    Object.entries(response.answers || {}).forEach(([questionId, answer]) => {
      const fieldName = questionMap.get(questionId);

      if (fieldName) {
        row[fieldName] = answer.textAnswers?.answers?.[0]?.value ?? "";
      }
    });
    const parseOptionalNumber = value => (value === undefined || value === "" ? null : Number(value));

    return {
      email: (row.email || "").trim().toLowerCase(),
      sessionId: row.sessionId ||
        `${(row.email || "").trim().toLowerCase()}|${row.date}|${row.routine}|${(row.submitted || "").slice(0, 13)}`,
      date: /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") ? row.date : (row.submitted || "").slice(0, 10),
      routine: (row.routine || "").trim(),
      exercise: (row.exercise || "").trim(),
      setNumber: parseOptionalNumber(row.setNumber),
      measure: row.measure === "time" ? "time" : "reps",
      reps: parseOptionalNumber(row.reps),
      durationSeconds: parseOptionalNumber(row.durationSeconds),
      weightKg: parseOptionalNumber(row.weightKg),
      rpe: parseOptionalNumber(row.rpe)
    };
  }

  async function loadData(interactive) {
    if (loading) {
      return;
    }

    if (!FORM_CONFIGURATION.formId) {
      showForkHelp("This site has no form ID configured for trends (form.formId in fitness/config.js).");

      return;
    }

    loading = true;
    $("#load-data").disabled = true;
    $("#fork-help").hidden = true;
    // Discard everything from the previous load so the view is rebuilt only from fresh form data.
    const keepUser = $("#user-select").value;
    rows = [];
    allRows = [];
    loadedAt = null;
    $("#results").hidden = true;
    $("#trends-empty").hidden = false;
    $("#user-select").innerHTML = "";
    $("#user-select").disabled = true;
    $("#user-field").hidden = true;
    setStatus("Loading your workouts…");

    try {
      let token = await getToken(false);
      let form;

      try {
        form = await fetchGoogleFormsResource(encodeURIComponent(FORM_CONFIGURATION.formId), token);
      } catch (error) {
        if (!(error instanceof GOOGLE_FORMS_REQUEST_ERROR) || error.status !== 401) {
          throw error;
        }

        token = await getToken(true);
        form = await fetchGoogleFormsResource(encodeURIComponent(FORM_CONFIGURATION.formId), token);
      }

      const questionMap = buildQuestionMap(form);

      if (!new Set(questionMap.values()).has("exercise")) {
        throw new Error("The form's questions don't match the workout tracker fields.");
      }

      const responses = await fetchAllResponses(token);
      allRows = responses.map(response => toWorkoutRow(response, questionMap))
        .filter(workoutRow => workoutRow.exercise);
      loadedAt = new Date();
      renderUserOptions(keepUser);
      applyUser();
    } catch (error) {
      handleLoadError(error, interactive);
    } finally {
      loading = false;
      $("#load-data").disabled = false;
    }
  }

  function handleLoadError(error, interactive) {
    sessionStorage.removeItem(SESSION_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);

    if (error instanceof GOOGLE_FORMS_REQUEST_ERROR ) {
      if (error.reason === "SERVICE_DISABLED" || error.reason === "accessNotConfigured") {
        showForkHelp("The Google Forms API isn't enabled in this site's Google Cloud project.");
        setStatus("");
      } else if (error.status === 403 || error.status === 404) {
        showForkHelp(`Your account (${WorkoutAuth.user.email}) doesn't have access to this site's Google Form, or the form wasn't found. ` +
          "If you own this site, check that form.formId in config.js is the ID from the form editor URL " +
          "(docs.google.com/forms/d/<ID>/edit), not the response spreadsheet's ID.");
        setStatus("");
      } else {
        setStatus(`Google Forms API error: ${error.message}`, "error");
      }

      return;
    }

    if (error.code === "popup_closed" || error.code === "popup_failed_to_open") {
      setStatus(interactive
        ? "The Google permission window was closed or blocked. Allow pop-ups and press Load my data. " +
        "If Google said \"Access blocked … has not completed the Google verification process\", " +
        "add your account as a test user on the site's OAuth consent screen."
        : "Press Load my data to give read access to your workout data.", interactive ? "error" : "");
    } else if (error.code === "access_denied") {
      setStatus(
        "Read access to the form wasn't granted, so trends can't be shown. Press Load my data to try again.",
        "error"
      );
    } else {
      setStatus(error.message || String(error), "error");
    }
  }

  // ---------- user filter ----------
  const ALL_USERS_OPTION_VALUE = "*";

  function renderUserOptions(previous) {
    const select = $("#user-select");
    const counts = new Map();
    allRows.forEach(workoutRow => counts.set(workoutRow.email, (counts.get(workoutRow.email) || 0) + 1));
    const users = [...counts.entries()].sort((firstUser, secondUser) =>
      secondUser[1] - firstUser[1] || firstUser[0].localeCompare(secondUser[0]));
    const signedInEmail = WorkoutAuth.user.email.toLowerCase();
    const formatEmailLabel = email => email || "(no email)";
    const userOptions = users.map(([email, setCount]) => {
      const emailLabel = escapeMarkup(formatEmailLabel(email));
      const signedInMarker = email === signedInEmail ? " (you)" : "";

      return `<option value="${escapeMarkup(email)}">${emailLabel}${signedInMarker} – ${setCount} set${setCount === 1 ? "" : "s"}</option>`;
    }).join("");
    const allUsersOption = users.length > 1
      ? `<option value="${ALL_USERS_OPTION_VALUE}">All users – ${allRows.length} sets</option>`
      : "";
    select.innerHTML = userOptions + allUsersOption;
    const userEmails = users.map(([email]) => email);

    if (previous && (userEmails.includes(previous) ||
        (previous === ALL_USERS_OPTION_VALUE && users.length > 1))) {
      select.value = previous;
    } else if (userEmails.includes(signedInEmail)) {
      select.value = signedInEmail;
    } else if (userEmails.length) {
      select.value = userEmails[0];
    }

    select.disabled = !users.length;
    $("#user-field").hidden = users.length < 2;
  }

  function applyUser() {
    const selected = $("#user-select").value;
    rows = selected === ALL_USERS_OPTION_VALUE
      ? allRows
      : allRows.filter(workoutRow => workoutRow.email === selected);
    const selectedUserDescription = selected === ALL_USERS_OPTION_VALUE ? "all users" : (selected || "(no email)");
    const loadedTimeDescription = loadedAt
      ? ` Loaded from the form at ${loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`
      : "";
    setStatus(allRows.length
      ? `Showing ${rows.length} set${rows.length === 1 ? "" : "s"} (all time) logged by ${selectedUserDescription}.${loadedTimeDescription}`
      : `No workouts have been logged in this form yet.${loadedTimeDescription}`, allRows.length ? "ok" : "");
    render();
  }

  // ---------- aggregation ----------
  function inRange(list) {
    const rangeInDays = Number($("#range").value);

    if (!rangeInDays) {
      return list;
    }

    const cutoffDate = new Date(Date.now() - rangeInDays * 86400000).toISOString().slice(0, 10);

    return list.filter(workoutRow => workoutRow.date >= cutoffDate);
  }

  function groupBy(items, keyFunction) {
    const groupsByKey = new Map();
    items.forEach(item => {
      const groupKey = keyFunction(item);

      if (!groupsByKey.has(groupKey)) {
        groupsByKey.set(groupKey, []);
      }

      groupsByKey.get(groupKey).push(item);
    });

    return groupsByKey;
  }

  function calculateWorkSeconds(workoutSet) {
    if (workoutSet.measure === "time") {
      return Number.isFinite(workoutSet.durationSeconds) ? workoutSet.durationSeconds : 0;
    }

    return Number.isFinite(workoutSet.reps) ? workoutSet.reps * SECONDS_PER_REPETITION : 0;
  }

  function summarizeSessions(workoutRows) {
    return [...groupBy(workoutRows, workoutRow => workoutRow.sessionId).values()].map(workoutSets => {
      const perceivedExertionValues = workoutSets.map(workoutSet => workoutSet.rpe).filter(Number.isFinite);

      return {
        date: workoutSets[0].date,
        routine: workoutSets[0].routine || "(no routine)",
        sets: workoutSets.length,
        estimatedSeconds: workoutSets.reduce(
          (total, workoutSet) => total + calculateWorkSeconds(workoutSet),
          0
        ) +
          Math.max(0, workoutSets.length - 1) * REST_SECONDS_BETWEEN_SETS,
        averagePerceivedExertion: calculateAverage(perceivedExertionValues)
      };
    }).sort((firstSession, secondSession) => firstSession.date.localeCompare(secondSession.date));
  }

  // One point per exercise per session.
  function exerciseSessions(list, exercise) {
    const matchingWorkoutRows = list.filter(workoutRow => workoutRow.exercise === exercise);

    return [...groupBy(matchingWorkoutRows, workoutRow => workoutRow.sessionId).values()].map(workoutSets => {
      const repetitionValues = workoutSets.map(workoutSet => workoutSet.reps).filter(Number.isFinite);
      const durationValues = workoutSets.map(workoutSet => workoutSet.durationSeconds).filter(Number.isFinite);
      const weightValues = workoutSets.map(workoutSet => workoutSet.weightKg)
        .filter(weight => Number.isFinite(weight) && weight > 0);
      const perceivedExertionValues = workoutSets.map(workoutSet => workoutSet.rpe).filter(Number.isFinite);

      return {
        date: workoutSets[0].date,
        routine: workoutSets[0].routine,
        sets: workoutSets.length,
        totalRepetitions: repetitionValues.length
          ? repetitionValues.reduce((total, repetitions) => total + repetitions, 0)
          : NaN,
        bestRepetitions: repetitionValues.length ? Math.max(...repetitionValues) : NaN,
        totalDurationSeconds: durationValues.length
          ? durationValues.reduce((total, duration) => total + duration, 0)
          : NaN,
        bestDurationSeconds: durationValues.length ? Math.max(...durationValues) : NaN,
        maximumWeight: weightValues.length ? Math.max(...weightValues) : NaN,
        volume: workoutSets.reduce((total, workoutSet) =>
          total + (Number.isFinite(workoutSet.reps) && Number.isFinite(workoutSet.weightKg)
            ? workoutSet.reps * workoutSet.weightKg
            : 0), 0),
        averagePerceivedExertion: calculateAverage(perceivedExertionValues)
      };
    }).sort((firstSession, secondSession) => firstSession.date.localeCompare(secondSession.date));
  }

  const EXERCISE_METRIC_DEFINITIONS = {
    totalRepetitions: { label: "Total reps", format: value => formatNumber(value, 0) },
    bestRepetitions: { label: "Best set (reps)", format: value => formatNumber(value, 0) },
    totalDurationSeconds: { label: "Total time", format: formatDuration },
    bestDurationSeconds: { label: "Best set (time)", format: formatDuration },
    maximumWeight: {
      get label() { return `Max weight (${WorkoutSettings.weightUnit})`; },
      format: value => formatNumber(WorkoutSettings.weightFromKg(value))
    },
    volume: {
      get label() { return `Volume (reps × ${WorkoutSettings.weightUnit})`; },
      format: value => formatNumber(WorkoutSettings.weightFromKg(value), 0)
    },
    averagePerceivedExertion: { label: "Average perceived difficulty", format: value => formatNumber(value) }
  };

  function metricsFor(sessions) {
    return Object.keys(EXERCISE_METRIC_DEFINITIONS).filter(metricName =>
      sessions.some(session => Number.isFinite(session[metricName]) &&
        (metricName !== "volume" || session[metricName] > 0)));
  }

  // ---------- rendering ----------
  function render() {
    const list = inRange(rows);
    $("#results").hidden = false;
    $("#trends-empty").hidden = true;
    const sessions = summarizeSessions(list);
    renderSummary(list, sessions);
    renderRoutines(sessions);
    renderExerciseOptions(list);
    renderExerciseTrend();
    renderExercisesTable(list);
  }

  function renderSummary(list, sessions) {
    const totalRepetitions = list.reduce((total, workoutRow) =>
      total + (Number.isFinite(workoutRow.reps) ? workoutRow.reps : 0), 0);
    const totalTimedSeconds = list.reduce((total, workoutRow) =>
      total + (Number.isFinite(workoutRow.durationSeconds) ? workoutRow.durationSeconds : 0), 0);
    const estimatedTrainingSeconds = sessions.reduce(
      (total, session) => total + session.estimatedSeconds,
      0
    );
    const cards = [
      ["Workouts", sessions.length],
      ["Sets", list.length],
      ["Total reps", totalRepetitions],
      ["Timed work", formatDuration(totalTimedSeconds)],
      ["Est. training time", formatDuration(estimatedTrainingSeconds)],
      ["Average difficulty", formatNumber(calculateAverage(
        list.map(workoutRow => workoutRow.rpe).filter(Number.isFinite)
      ))]
    ];
    $("#summary").innerHTML = cards.map(([label, value]) =>
      `<div class="stat"><span class="stat-value">${escapeMarkup(value)}</span>` +
      `<span class="stat-label">${escapeMarkup(label)}</span></div>`).join("");
  }

  function renderRoutines(sessions) {
    const groups = [...groupBy(sessions, session => session.routine).entries()]
      .map(([routine, routineSessions]) => ({
        routine,
        count: routineSessions.length,
        last: routineSessions[routineSessions.length - 1].date,
        averageSetCount: calculateAverage(routineSessions.map(session => session.sets)),
        averageEstimatedSeconds: calculateAverage(
          routineSessions.map(session => session.estimatedSeconds)
        ),
        averagePerceivedExertion: calculateAverage(routineSessions.map(session =>
          session.averagePerceivedExertion).filter(Number.isFinite)),
        perceivedExertionTrend: routineSessions.length > 1
          ? routineSessions[routineSessions.length - 1].averagePerceivedExertion -
            routineSessions[0].averagePerceivedExertion
          : NaN
      }))
      .sort((firstRoutine, secondRoutine) => secondRoutine.last.localeCompare(firstRoutine.last));
    $("#routines-table").innerHTML = groups.length ? `
      <thead>
        <tr>
          <th>Routine</th><th>Workouts</th><th>Last done</th><th>Avg sets</th>
          <th>Avg est. time</th><th>Avg difficulty</th><th>Difficulty change</th>
        </tr>
      </thead>
      <tbody>${groups.map(routineSummary => `<tr>
        <td>${escapeMarkup(routineSummary.routine)}</td><td>${routineSummary.count}</td><td>${escapeMarkup(routineSummary.last)}</td>
        <td>${formatNumber(routineSummary.averageSetCount)}</td>
        <td>${formatDuration(routineSummary.averageEstimatedSeconds)}</td>
        <td>${formatNumber(routineSummary.averagePerceivedExertion)}</td>
        <td>${trendCell(routineSummary.perceivedExertionTrend, true)}</td>
      </tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="muted">No workouts in this period.</td></tr></tbody>`;
  }

  // For difficulty, a falling value at the same workload is the good direction.
  function trendCell(delta, lowerIsBetter = false) {
    if (!Number.isFinite(delta) || delta === 0) {
      return `<span class="muted">–</span>`;
    }

    const improvementIsPositive = lowerIsBetter ? delta < 0 : delta > 0;

    return `<span class="${improvementIsPositive ? "up" : "down"}">${delta > 0 ? "▲" : "▼"} ${formatNumber(Math.abs(delta))}</span>`;
  }

  function renderExerciseOptions(list) {
    const exerciseSelect = $("#exercise-select");
    const previousExercise = exerciseSelect.value;
    const exerciseSetCounts = [...groupBy(list, workoutRow => workoutRow.exercise).entries()]
      .map(([exerciseName, workoutRows]) => ({
        name: exerciseName,
        sessions: new Set(workoutRows.map(workoutRow => workoutRow.sessionId)).size
      }))
      .sort((firstExercise, secondExercise) =>
        secondExercise.sessions - firstExercise.sessions || firstExercise.name.localeCompare(secondExercise.name));
    exerciseSelect.innerHTML = exerciseSetCounts.map(exerciseCount =>
      `<option value="${escapeMarkup(exerciseCount.name)}">` +
      `${escapeMarkup(exerciseCount.name)} (${exerciseCount.sessions})</option>`).join("");

    if (exerciseSetCounts.some(exerciseCount => exerciseCount.name === previousExercise)) {
      exerciseSelect.value = previousExercise;
    }
  }

  function renderExerciseTrend() {
    const exercise = $("#exercise-select").value;
    const sessions = exercise ? exerciseSessions(inRange(rows), exercise) : [];
    const metricSelect = $("#metric-select");
    const previousMetric = metricSelect.value;
    const availableMetrics = metricsFor(sessions);
    metricSelect.innerHTML = availableMetrics.map(metricName =>
      `<option value="${metricName}">${EXERCISE_METRIC_DEFINITIONS[metricName].label}</option>`).join("");

    if (availableMetrics.includes(previousMetric)) {
      metricSelect.value = previousMetric;
    } else {
      metricSelect.value = ["maximumWeight", "totalRepetitions", "totalDurationSeconds"].find(metricName =>
        availableMetrics.includes(metricName)) || availableMetrics[0] || "";
    }

    const metric = metricSelect.value;
    $("#chart").innerHTML = metric
      ? lineChart(
        sessions.filter(session => Number.isFinite(session[metric]))
          .map(session => ({ date: session.date, value: session[metric] })),
        EXERCISE_METRIC_DEFINITIONS[metric]
      )
      : `<p class="muted">No data for this exercise in the selected period.</p>`;

    const includesTimedSets = sessions.some(session => Number.isFinite(session.totalDurationSeconds));
    $("#exercise-table").innerHTML = sessions.length ? `
      <thead><tr><th>Date</th><th>Routine</th><th>Sets</th>
        <th>${includesTimedSets ? "Total time" : "Total reps"}</th><th>${includesTimedSets ? "Best set" : "Best set (reps)"}</th>
        <th>Max weight</th><th>Avg difficulty</th></tr></thead>
      <tbody>${sessions.slice().reverse().map(session => `<tr>
        <td>${escapeMarkup(session.date)}</td><td>${escapeMarkup(session.routine || "–")}</td><td>${session.sets}</td>
        <td>${includesTimedSets ? formatDuration(session.totalDurationSeconds) : formatNumber(session.totalRepetitions, 0)}</td>
        <td>${includesTimedSets ? formatDuration(session.bestDurationSeconds) : formatNumber(session.bestRepetitions, 0)}</td>
        <td>${Number.isFinite(session.maximumWeight) ? `${formatNumber(WorkoutSettings.weightFromKg(session.maximumWeight))} ${WorkoutSettings.weightUnit}` : "–"}</td>
        <td>${formatNumber(session.averagePerceivedExertion)}</td></tr>`).join("")}</tbody>` : "";
  }

  function renderExercisesTable(list) {
    const exerciseSummaries = [...groupBy(list, workoutRow => workoutRow.exercise).keys()].map(exerciseName => {
      const sessions = exerciseSessions(list, exerciseName);
      const includesTimedSets = sessions.some(session => Number.isFinite(session.totalDurationSeconds));
      const totalMetricName = includesTimedSets ? "totalDurationSeconds" : "totalRepetitions";
      const firstSession = sessions[0];
      const lastSession = sessions[sessions.length - 1];

      return {
        name: exerciseName,
        includesTimedSets,
        count: sessions.length,
        lastDate: lastSession.date,
        latest: lastSession[totalMetricName],
        change: sessions.length > 1
          ? lastSession[totalMetricName] - firstSession[totalMetricName]
          : NaN,
        maximumWeight: Math.max(
          ...sessions.map(session => session.maximumWeight).filter(Number.isFinite),
          -Infinity
        ),
        averagePerceivedExertion: calculateAverage(sessions.map(session =>
          session.averagePerceivedExertion).filter(Number.isFinite))
      };
    }).sort((firstExercise, secondExercise) =>
      secondExercise.lastDate.localeCompare(firstExercise.lastDate) ||
      firstExercise.name.localeCompare(secondExercise.name));
    $("#exercises-table").innerHTML = exerciseSummaries.length ? `
      <thead>
        <tr>
          <th>Exercise</th><th>Workouts</th><th>Last done</th><th>Latest total</th>
          <th>Change</th><th>Max weight</th><th>Avg difficulty</th>
        </tr>
      </thead>
      <tbody>${exerciseSummaries.map(exerciseSummary => `<tr>
        <td><a href="#" class="ex-link" data-name="${escapeMarkup(exerciseSummary.name)}">${escapeMarkup(exerciseSummary.name)}</a></td>
        <td>${exerciseSummary.count}</td><td>${escapeMarkup(exerciseSummary.lastDate)}</td>
        <td>${exerciseSummary.includesTimedSets
          ? formatDuration(exerciseSummary.latest)
          : `${formatNumber(exerciseSummary.latest, 0)} reps`}</td>
        <td>${exerciseSummary.includesTimedSets
          ? timeTrendCell(exerciseSummary.change)
          : trendCell(exerciseSummary.change)}</td>
        <td>${Number.isFinite(exerciseSummary.maximumWeight) ? `${formatNumber(WorkoutSettings.weightFromKg(exerciseSummary.maximumWeight))} ${WorkoutSettings.weightUnit}` : "–"}</td>
        <td>${formatNumber(exerciseSummary.averagePerceivedExertion)}</td>
      </tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="muted">No exercises in this period.</td></tr></tbody>`;
  }

  function timeTrendCell(delta) {
    if (!Number.isFinite(delta) || delta === 0) {
      return `<span class="muted">–</span>`;
    }

    return `<span class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"} ${formatDuration(Math.abs(delta))}</span>`;
  }

  // ---------- SVG line chart ----------
  function lineChart(points, metricDefinition) {
    if (!points.length) {
      return `<p class="muted">No data for this metric.</p>`;
    }

    const chartWidth = 640;
    const chartHeight = 260;
    const chartPadding = { left: 56, right: 16, top: 16, bottom: 40 };
    const dateValues = points.map(point => Date.parse(point.date));
    const earliestDateValue = Math.min(...dateValues);
    const latestDateValue = Math.max(...dateValues);
    const metricValues = points.map(point => point.value);
    let minimumMetricValue = Math.min(0, ...metricValues);
    let maximumMetricValue = Math.max(...metricValues);

    if (maximumMetricValue === minimumMetricValue) {
      maximumMetricValue = minimumMetricValue + 1;
    }

    maximumMetricValue += (maximumMetricValue - minimumMetricValue) * 0.1;
    const getHorizontalPosition = dateValue => chartPadding.left +
      (latestDateValue === earliestDateValue
        ? (chartWidth - chartPadding.left - chartPadding.right) / 2
        : ((dateValue - earliestDateValue) / (latestDateValue - earliestDateValue)) *
          (chartWidth - chartPadding.left - chartPadding.right));
    const getVerticalPosition = metricValue => chartHeight - chartPadding.bottom -
      ((metricValue - minimumMetricValue) / (maximumMetricValue - minimumMetricValue)) *
        (chartHeight - chartPadding.top - chartPadding.bottom);
    const tickCount = 4;
    const gridLines = Array.from({ length: tickCount + 1 }, (_, tickIndex) => {
      const metricValue = minimumMetricValue + ((maximumMetricValue - minimumMetricValue) * tickIndex) / tickCount;
      const verticalPosition = getVerticalPosition(metricValue);
      const formattedMetricValue = escapeMarkup(metricDefinition.format(metricValue));

      return `<line
          x1="${chartPadding.left}"
          x2="${chartWidth - chartPadding.right}"
          y1="${verticalPosition}"
          y2="${verticalPosition}"
          class="grid"/>
        <text
          x="${chartPadding.left - 8}"
          y="${verticalPosition + 4}"
          text-anchor="end">${formattedMetricValue}</text>`;
    }).join("");
    const dateLabelIndices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    const getDateLabelAnchor = dateValue => (latestDateValue === earliestDateValue
      ? "middle"
      : dateValue === earliestDateValue
        ? "start"
        : dateValue === latestDateValue
          ? "end"
          : "middle");
    const dateLabels = dateLabelIndices.map(pointIndex => {
      const horizontalPosition = getHorizontalPosition(dateValues[pointIndex]);
      const labelAnchor = getDateLabelAnchor(dateValues[pointIndex]);
      const dateLabel = escapeMarkup(points[pointIndex].date);

      return `<text
          x="${horizontalPosition}"
          y="${chartHeight - chartPadding.bottom + 24}"
          text-anchor="${labelAnchor}">${dateLabel}</text>`;
    }).join("");
    const linePath = points.map((point, pointIndex) => {
      const horizontalPosition = getHorizontalPosition(dateValues[pointIndex]).toFixed(1);
      const verticalPosition = getVerticalPosition(point.value).toFixed(1);

      return `${pointIndex ? "L" : "M"}${horizontalPosition},${verticalPosition}`;
    }).join(" ");
    const chartDots = points.map((point, pointIndex) => {
      const horizontalPosition = getHorizontalPosition(dateValues[pointIndex]);
      const verticalPosition = getVerticalPosition(point.value);
      const formattedMetricValue = escapeMarkup(metricDefinition.format(point.value));

      return `<circle cx="${horizontalPosition}" cy="${verticalPosition}" r="4">
        <title>${escapeMarkup(point.date)}: ${formattedMetricValue}</title>
      </circle>`;
    }).join("");

    return `<svg viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="${escapeMarkup(metricDefinition.label)} over time">
      ${gridLines}${dateLabels}<path d="${linePath}" class="line"/>${chartDots}</svg>`;
  }

  // ---------- boot ----------
  function onSignIn() {
    $("#trends-view").hidden = false;

    if (!FORM_CONFIGURATION.formId) {
      showForkHelp("This site has no form ID configured for trends (form.formId in fitness/config.js).");
      $("#load-data").disabled = true;

      return;
    }

    // Without a cached token Google may need a popup; the load reports that as a prompt to press the button.
    loadData(false);
  }

  function onSignOut() {
    sessionStorage.removeItem(SESSION_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);
    rows = [];
    allRows = [];
    $("#user-select").innerHTML = "";
    $("#user-select").disabled = true;
    $("#user-field").hidden = true;
    $("#trends-view").hidden = true;
    $("#results").hidden = true;
    $("#trends-empty").hidden = false;
    $("#fork-help").hidden = true;
    setStatus("");
  }

  $("#load-data").addEventListener("click", () => loadData(true));
  $("#range").addEventListener("change", () => allRows.length && render());
  $("#user-select").addEventListener("change", applyUser);
  $("#exercise-select").addEventListener("change", renderExerciseTrend);
  $("#metric-select").addEventListener("change", renderExerciseTrend);
  document.addEventListener("workout:unitschange", () => {
    if (!$("#results").hidden) {
      render();
    }
  });
  $("#exercises-table").addEventListener("click", event => {
    const link = event.target.closest(".ex-link");

    if (!link) {
      return;
    }

    event.preventDefault();
    $("#exercise-select").value = link.dataset.name;
    renderExerciseTrend();
    $("#chart").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  WorkoutAuth.init({ onSignIn, onSignOut });
})();
