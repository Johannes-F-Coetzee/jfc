(() => {
  "use strict";

  const WORKOUT_CONFIGURATION = window.WORKOUT_CONFIG || {};
  const FORM_CONFIGURATION = WORKOUT_CONFIGURATION.form || {};
  const STORAGE_KEYS = {
    draft: "workout.draft",
    queue: "workout.queue",
    history: "workout.history"
  };
  const PERCEIVED_EXERTION_LABELS = {
    1: "Very light", 2: "Light", 3: "Light", 4: "Moderate", 5: "Moderate",
    6: "Moderate+", 7: "Hard", 8: "Hard+", 9: "Very hard", 10: "Max effort"
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  let currentUser = null;
  let flushing = false;
  const ROUTINES_FILE_PATH = "routines.json";
  let fileRoutines = new Map();
  let routinesError = "";

  // ---------- storage helpers ----------
  function readJson(storage, key, fallback) {
    try {
      const value = storage.getItem(key);

      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  // ---------- configuration checks ----------
  function hasFormConfig() {
    const fields = FORM_CONFIGURATION.fields || {};

    return typeof FORM_CONFIGURATION.actionUrl === "string" &&
      /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(FORM_CONFIGURATION.actionUrl) &&
      Object.values(fields).some(entryId => /^entry\.\d+$/.test(entryId));
  }

  function showSetupWarnings() {
    const problems = [];

    if (!WorkoutAuth.hasConfiguredGoogleClientIdentifier()) {
      problems.push("<code>googleClientId</code> is not set - Google sign-in is disabled.");
    }

    if (!hasFormConfig()) {
      problems.push("The Google Form <code>actionUrl</code> / entry IDs are not set - workouts cannot be submitted.");
    }

    const box = $("#setup-warning");

    if (problems.length) {
      box.innerHTML = "<strong>Setup required</strong> (edit <code>workouts/config.js</code>):<ul>" +
        problems.map(problem => `<li>${problem}</li>`).join("") + "</ul>";
      box.hidden = false;
    }
  }

  // ---------- authentication (see auth.js) ----------
  function showTracker(user) {
    currentUser = user;
    $("#tracker-view").hidden = false;
    $("#submit-workout").disabled = !hasFormConfig();
    refreshRoutineList();
    renderHistory();
    updateQueueUi();
    flushQueue();
  }

  function hideTracker() {
    currentUser = null;
    $("#tracker-view").hidden = true;
  }

  // ---------- duration helpers ----------
  function parseDuration(text) {
    const value = String(text || "").trim();

    if (!value) {
      return null;
    }

    if (/^\d+$/.test(value)) {
      return parseInt(value, 10);
    }

    const match = value.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);

    if (!match) {
      return NaN;
    }

    const [, hour, minute, second] = match;

    return (parseInt(hour || "0", 10) * 3600) + parseInt(minute, 10) * 60 + parseInt(second, 10);
  }

  function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) {
      return "";
    }

    const minutes = Math.floor(seconds / 60);
    const secondsRemaining = seconds % 60;

    return `${minutes}:${String(secondsRemaining).padStart(2, "0")}`;
  }

  // ---------- workout DOM ----------
  function todayIso() {
    const date = new Date();

    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function updatePerceivedExertionLabel(setElement) {
    const value = $(".set-rpe", setElement).value;
    $(".rpe-out", setElement).textContent = `${value} · ${PERCEIVED_EXERTION_LABELS[value]}`;
  }

  function renumberSets(exerciseElement) {
    $$(".set", exerciseElement).forEach((setElement, setIndex) => {
      $(".set-no", setElement).textContent = setIndex + 1;
    });
  }

  function addSet(exerciseElement, data = {}) {
    const setElement = $("#set-template").content.firstElementChild.cloneNode(true);
    $(".set-reps", setElement).value = data.reps ?? "";
    $(".set-time", setElement).value = data.durationSeconds != null ? formatDuration(data.durationSeconds) : "";
    $(".set-weight", setElement).value = data.weightKg ?? "";
    $(".set-rpe", setElement).value = data.rpe ?? 5;
    $(".set-notes", setElement).value = data.notes ?? "";
    updatePerceivedExertionLabel(setElement);
    $(".sets", exerciseElement).appendChild(setElement);
    renumberSets(exerciseElement);

    return setElement;
  }

  function addExercise(data = {}) {
    const exerciseElement = $("#exercise-template").content.firstElementChild.cloneNode(true);
    $(".ex-name", exerciseElement).value = data.name ?? "";
    const measure = data.measure === "time" ? "time" : "reps";
    $(".ex-measure", exerciseElement).value = measure;
    exerciseElement.dataset.measure = measure;
    const workoutSets = data.sets && data.sets.length ? data.sets : [{}];
    workoutSets.forEach(setData => addSet(exerciseElement, setData));
    $("#exercises").appendChild(exerciseElement);

    return exerciseElement;
  }

  function stopTimer(setElement) {
    if (setElement._timer) {
      clearInterval(setElement._timer);
      setElement._timer = null;
      const button = $(".set-timer", setElement);
      button.innerHTML = "&#9654;";
      button.classList.remove("running");
      saveDraft();
    }
  }

  function toggleTimer(setElement) {
    if (setElement._timer) {
      stopTimer(setElement);

      return;
    }

    $$(".set").forEach(stopTimer);
    const input = $(".set-time", setElement);
    const base = parseDuration(input.value) || 0;
    const start = Date.now();
    const button = $(".set-timer", setElement);
    button.innerHTML = "&#9632;";
    button.classList.add("running");
    setElement._timer = setInterval(() => {
      input.value = formatDuration(base + Math.floor((Date.now() - start) / 1000));
      updateEstimate();
    }, 250);
  }

  function collectWorkout() {
    return {
      date: $("#workout-date").value,
      routine: $("#routine-name").value.trim(),
      sessionNotes: $("#session-notes").value.trim(),
      exercises: $$("#exercises .exercise").map(exerciseElement => {
        const measure = $(".ex-measure", exerciseElement).value;

        return {
          name: $(".ex-name", exerciseElement).value.trim(),
          measure,
          sets: $$(".set", exerciseElement).map(setElement => {
            const repetitionCount = $(".set-reps", setElement).value;
            const weight = $(".set-weight", setElement).value;

            return {
              reps: measure === "reps" && repetitionCount !== "" ? Number(repetitionCount) : null,
              durationSeconds: measure === "time" ? parseDuration($(".set-time", setElement).value) : null,
              weightKg: weight !== "" ? Number(weight) : null,
              rpe: Number($(".set-rpe", setElement).value),
              notes: $(".set-notes", setElement).value.trim()
            };
          })
        };
      })
    };
  }

  function renderWorkout(workout) {
    $$(".set").forEach(stopTimer);
    $("#workout-date").value = workout.date || todayIso();
    $("#routine-name").value = workout.routine || "";
    $("#session-notes").value = workout.sessionNotes || "";
    $("#exercises").innerHTML = "";
    (workout.exercises && workout.exercises.length ? workout.exercises : [{}]).forEach(addExercise);
    refreshExerciseNames();
    updateEstimate();
  }

  // ---------- drafts & routines ----------
  let draftTimer = null;

  function saveDraft() {
    updateEstimate();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => writeJson(localStorage, STORAGE_KEYS.draft, collectWorkout()), 300);
  }

  // Timed sets count as entered, each rep counts 10 s, plus 1 min rest between consecutive sets.
  const SECONDS_PER_REPETITION = 10;
  const REST_SECONDS_BETWEEN_SETS = 60;

  function estimateSeconds(workout) {
    let work = 0;
    let sets = 0;
    workout.exercises.forEach(exercise => exercise.sets.forEach(workoutSet => {
      sets += 1;

      if (exercise.measure === "time") {
        work += Number.isFinite(workoutSet.durationSeconds) ? workoutSet.durationSeconds : 0;
      } else {
        work += Number.isFinite(workoutSet.reps) ? workoutSet.reps * SECONDS_PER_REPETITION : 0;
      }
    }));

    return work + Math.max(0, sets - 1) * REST_SECONDS_BETWEEN_SETS;
  }

  function formatEstimate(seconds) {
    const hours = Math.floor(seconds / 3600);
    const rest = formatDuration(seconds % 3600);

    return hours ? `${hours}:${rest.padStart(5, "0")}` : rest;
  }

  function updateEstimate() {
    $("#estimated-time-value").textContent = formatEstimate(estimateSeconds(collectWorkout()));
  }

  function routineTemplate(workout) {
    return workout.exercises
      .filter(exercise => exercise.name)
      .map(exercise => ({
        name: exercise.name,
        measure: exercise.measure,
        sets: exercise.sets.map(workoutSet => {
          const set = {};

          if (exercise.measure === "reps" && Number.isFinite(workoutSet.reps)) {
            set.reps = workoutSet.reps;
          }

          if (exercise.measure === "time" && Number.isFinite(workoutSet.durationSeconds)) {
            set.durationSeconds = workoutSet.durationSeconds;
          }

          if (Number.isFinite(workoutSet.weightKg)) {
            set.weightKg = workoutSet.weightKg;
          }

          return set;
        })
      }));
  }

  // Accepts loosely-typed JSON from routines.json and returns a clean { name, exercises } or null.
  function normalizeRoutine(raw) {
    if (!raw || typeof raw.name !== "string" || !raw.name.trim() || !Array.isArray(raw.exercises)) {
      return null;
    }

    const numberOrNull = value => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
    const exercises = raw.exercises
      .filter(exercise => exercise && typeof exercise.name === "string" && exercise.name.trim())
      .map(exercise => ({
        name: exercise.name.trim(),
        measure: exercise.measure === "time" ? "time" : "reps",
        sets: (Array.isArray(exercise.sets) && exercise.sets.length ? exercise.sets : [{}]).map(setData => ({
          reps: numberOrNull(setData?.reps),
          durationSeconds: numberOrNull(setData?.durationSeconds),
          weightKg: numberOrNull(setData?.weightKg)
        }))
      }));

    return exercises.length ? { name: raw.name.trim(), exercises } : null;
  }

  async function loadRoutinesFile() {
    try {
      const response = await fetch(ROUTINES_FILE_PATH, { cache: "no-cache" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const list = Array.isArray(data) ? data : data.routines;

      if (!Array.isArray(list)) {
        throw new Error("missing \"routines\" array");
      }

      fileRoutines = new Map();
      list.map(normalizeRoutine).filter(Boolean).forEach(routine => fileRoutines.set(routine.name, routine));
      routinesError = "";
    } catch (error) {
      fileRoutines = new Map();
      routinesError = `Could not load ${ROUTINES_FILE_PATH}: ${error.message}`;
    }
    refreshRoutineList();
    refreshExerciseNames();
  }

  function findRoutine(name) {
    if (fileRoutines.has(name)) {
      return fileRoutines.get(name);
    }

    const lower = name.toLowerCase();

    return [...fileRoutines.values()].find(routine => routine.name.toLowerCase() === lower) || null;
  }

  function refreshRoutineList() {
    $("#routine-list").innerHTML = [...fileRoutines.keys()].sort()
      .map(routineName => `<option value="${escapeMarkup(routineName)}"></option>`).join("");
  }

  function exportRoutines(typedName, workout) {
    const exercises = routineTemplate(workout);

    if (!exercises.length) {
      return false;
    }

    const merged = new Map([...fileRoutines].map(([routineKey, routine]) => [
      routineKey,
      { name: routine.name, exercises: routineTemplate(routine) }
    ]));
    const name = findRoutine(typedName)?.name || typedName;
    merged.set(name, { name, exercises });
    const json = JSON.stringify({ routines: [...merged.values()] }, null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "routines.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return true;
  }

  function refreshExerciseNames() {
    const names = new Set();
    fileRoutines.forEach(routine => routine.exercises.forEach(exercise => names.add(exercise.name)));
    $$("#exercises .ex-name").forEach(input => input.value.trim() && names.add(input.value.trim()));
    $("#exercise-names").innerHTML = [...names].sort()
      .map(exerciseName => `<option value="${escapeMarkup(exerciseName)}"></option>`).join("");
  }

  function escapeMarkup(text) {
    return String(text).replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  // ---------- status ----------
  function setStatus(message, kind = "") {
    const element = $("#status");
    element.textContent = message;
    element.className = `status ${kind}`;
  }

  // ---------- Google Forms submission ----------
  function readQueue() {
    return readJson(localStorage, STORAGE_KEYS.queue, []);
  }

  function writeQueue(queue) {
    writeJson(localStorage, STORAGE_KEYS.queue, queue);
  }

  function updateQueueUi() {
    const count = readQueue().length;
    $("#queue-box").hidden = count === 0;
    $("#queue-text").textContent = `${count} set${count === 1 ? "" : "s"} waiting to be sent.`;
  }

  async function postToForm(row) {
    if (!currentUser) {
      throw new Error("Sign in before submitting workout data.");
    }

    const body = new URLSearchParams();

    for (const [key, entry] of Object.entries(FORM_CONFIGURATION.fields || {})) {
      const value = row[key];

      if (entry && value !== null && value !== undefined && value !== "") {
        body.append(entry, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      // Google Forms does not send CORS headers, so the response is opaque; only network failures are detectable.
      await fetch(FORM_CONFIGURATION.actionUrl, { method: "POST", mode: "no-cors", body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function flushQueue() {
    if (!currentUser) {
      return false;
    }

    if (flushing || !hasFormConfig()) {
      return readQueue().length === 0;
    }

    flushing = true;

    try {
      let next;

      while ((next = readQueue()[0])) {
        await postToForm(next);
        writeQueue(readQueue().filter(queueRow => queueRow.id !== next.id));
        updateQueueUi();
      }

      return true;
    } catch {
      return false;
    } finally {
      flushing = false;
      updateQueueUi();
    }
  }

  function buildRows(workout) {
    const sessionId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const rows = [];
    workout.exercises.forEach((exercise, exerciseIndex) => {
      exercise.sets.forEach((set, setIndex) => {
        rows.push({
          id: `${sessionId}:${exerciseIndex}:${setIndex}`,
          email: currentUser.email,
          sessionId,
          date: workout.date,
          routine: workout.routine,
          exercise: exercise.name,
          exerciseOrder: exerciseIndex + 1,
          setNumber: setIndex + 1,
          measure: exercise.measure,
          reps: set.reps,
          durationSeconds: set.durationSeconds,
          weightKg: set.weightKg,
          rpe: set.rpe,
          notes: set.notes,
          sessionNotes: workout.sessionNotes
        });
      });
    });

    return { sessionId, rows };
  }

  function validate(workout) {
    if (!workout.date) {
      return "Please choose a date.";
    }

    if (!workout.exercises.length) {
      return "Add at least one exercise.";
    }

    for (const [exerciseIndex, exercise] of workout.exercises.entries()) {
      if (!exercise.name) {
        return `Exercise ${exerciseIndex + 1} needs a name.`;
      }

      if (!exercise.sets.length) {
        return `${exercise.name} has no sets.`;
      }

      for (const [setIndex, set] of exercise.sets.entries()) {
        if (exercise.measure === "reps" && (set.reps === null || !Number.isFinite(set.reps) || set.reps < 0)) {
          return `${exercise.name}, set ${setIndex + 1}: enter the number of reps.`;
        }

        if (exercise.measure === "time" && (set.durationSeconds === null || Number.isNaN(set.durationSeconds))) {
          return `${exercise.name}, set ${setIndex + 1}: enter a time such as 0:45 or 45.`;
        }
      }
    }

    return null;
  }

  async function submitWorkout(event) {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    $$(".set").forEach(stopTimer);
    const workout = collectWorkout();
    const error = validate(workout);

    if (error) {
      setStatus(error, "error");

      return;
    }

    const { sessionId, rows } = buildRows(workout);
    writeQueue(readQueue().concat(rows));
    updateQueueUi();
    const history = readJson(localStorage, STORAGE_KEYS.history, []);
    const perceivedExertionValues = rows.map(row => row.rpe);
    history.unshift({
      sessionId,
      date: workout.date,
      routine: workout.routine,
      exercises: workout.exercises.map(exercise => `${exercise.name} ×${exercise.sets.length}`),
      avgRpe: Math.round((perceivedExertionValues.reduce((total, value) => total + value, 0) / perceivedExertionValues.length) * 10) / 10
    });
    writeJson(localStorage, STORAGE_KEYS.history, history.slice(0, 20));
    $("#submit-workout").disabled = true;
    setStatus("Sending…");
    const sent = await flushQueue();
    $("#submit-workout").disabled = false;
    renderWorkout({ routine: workout.routine, exercises: routineTemplate(workout) });
    localStorage.removeItem(STORAGE_KEYS.draft);
    renderHistory();
    setStatus(sent
      ? `Workout saved (${rows.length} set${rows.length === 1 ? "" : "s"}).`
      : "You appear to be offline. The workout is saved on this device and will be sent automatically.",
      sent ? "ok" : "error");
  }

  function renderHistory() {
    const history = readJson(localStorage, STORAGE_KEYS.history, []);
    $("#history").innerHTML = history.length
      ? history.map(workout => `<li><strong>${escapeMarkup(workout.date)}</strong> ${escapeMarkup(workout.routine || "Workout")}
          <span class="muted">· avg difficulty ${workout.avgRpe}</span><br>
          <span class="muted">${workout.exercises.map(escapeMarkup).join(", ")}</span></li>`).join("")
      : `<li class="muted">No workouts logged yet.</li>`;
  }

  // ---------- event wiring ----------
  function wireEvents() {
    const form = $("#workout-form");
    form.addEventListener("submit", submitWorkout);
    form.addEventListener("input", event => {
      if (event.target.classList.contains("set-rpe")) {
        updatePerceivedExertionLabel(event.target.closest(".set"));
      }

      saveDraft();
    });
    form.addEventListener("change", event => {
      const target = event.target;

      if (target.classList.contains("ex-measure")) {
        target.closest(".exercise").dataset.measure = target.value;
      }

      if (target.classList.contains("set-time")) {
        const seconds = parseDuration(target.value);

        if (seconds !== null && !Number.isNaN(seconds)) {
          target.value = formatDuration(seconds);
        }
      }

      if (target.classList.contains("ex-name")) {
        refreshExerciseNames();
      }

      saveDraft();
    });
    form.addEventListener("click", event => {
      const button = event.target.closest("button");

      if (!button) {
        return;
      }

      const exerciseElement = button.closest(".exercise");
      const setElement = button.closest(".set");

      if (button.classList.contains("ex-add-set")) {
        const workoutSets = collectWorkout().exercises[$$("#exercises .exercise").indexOf(exerciseElement)].sets;
        const lastSet = workoutSets[workoutSets.length - 1] || {};
        addSet(exerciseElement, { ...lastSet, notes: "" });
      } else if (button.classList.contains("set-remove")) {
        stopTimer(setElement);

        if ($$(".set", exerciseElement).length > 1) {
          setElement.remove();
          renumberSets(exerciseElement);
        }
      } else if (button.classList.contains("ex-remove")) {
        $$(".set", exerciseElement).forEach(stopTimer);
        exerciseElement.remove();

        if (!$$("#exercises .exercise").length) {
          addExercise();
        }
      } else if (button.classList.contains("set-timer")) {
        toggleTimer(setElement);

        return;
      } else {
        return;
      }

      saveDraft();
    });

    $("#add-exercise").addEventListener("click", () => {
      const exerciseElement = addExercise();
      $(".ex-name", exerciseElement).focus();
      saveDraft();
    });

    $("#load-routine").addEventListener("click", async () => {
      const name = $("#routine-name").value.trim();

      if (!name) {
        setStatus("Type or pick a routine name first.", "error");

        return;
      }

      await loadRoutinesFile();

      if (routinesError) {
        setStatus(routinesError, "error");

        return;
      }

      const routine = findRoutine(name);

      if (!routine) {
        setStatus(`No routine called "${name}" in routines.json.`, "error");

        return;
      }

      renderWorkout({ date: $("#workout-date").value, routine: routine.name, exercises: routine.exercises });
      saveDraft();
      setStatus(`Loaded routine "${routine.name}".`, "ok");
    });

    $("#export-routine").addEventListener("click", () => {
      const name = $("#routine-name").value.trim();

      if (!name) {
        setStatus("Enter a routine name first.", "error");

        return;
      }

      const exported = exportRoutines(name, collectWorkout());
      setStatus(exported
        ? `Exported routines.json with "${name}". Replace workouts/routines.json in the repo with it to publish.`
        : "Add at least one named exercise before exporting.", exported ? "ok" : "error");
    });

    $("#clear-workout").addEventListener("click", () => {
      if (!confirm("Clear the current workout?")) {
        return;
      }

      renderWorkout({});
      localStorage.removeItem(STORAGE_KEYS.draft);
      setStatus("");
    });

    $("#retry-queue").addEventListener("click", async () => {
      setStatus("Sending…");
      const sent = await flushQueue();
      setStatus(sent ? "All pending sets sent." : "Still offline - will retry automatically.", sent ? "ok" : "error");
    });

    window.addEventListener("online", () => currentUser && flushQueue());
  }

  // ---------- boot ----------
  function boot() {
    showSetupWarnings();
    wireEvents();
    renderWorkout(readJson(localStorage, STORAGE_KEYS.draft, {}));
    loadRoutinesFile();
    WorkoutAuth.init({ onSignIn: showTracker, onSignOut: hideTracker });
  }

  boot();
})();
