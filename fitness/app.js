(() => {
  "use strict";

  const WORKOUT_CONFIGURATION = window.WORKOUT_CONFIG || {};
  const FORM_CONFIGURATION = WORKOUT_CONFIGURATION.form || {};
  const SUBMISSION_STATUS = window.WorkoutSubmissionStatus;
  const WORKOUT_UTILITIES = window.WorkoutUtilities;
  const escapeMarkup = WORKOUT_UTILITIES.escapeHtml;
  const STORAGE_KEYS = {
    draft: "workout.draft",
    queue: "workout.queue",
    history: "workout.history"
  };
  const PERCEIVED_EXERTION_LABELS = {
    1: "Very light", 2: "Light", 3: "Light", 4: "Moderate", 5: "Moderate",
    6: "Moderate+", 7: "Hard", 8: "Hard+", 9: "Very hard", 10: "Max effort"
  };
  const POPUP_ERROR_CODES = new Set(["popup_failed_to_open", "popup_closed"]);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  let currentUser = null;
  let flushing = false;
  let sharedRoutines = new Map();
  let routinesLoaded = false;
  let routinesBusy = false;
  let automaticRoutineLoadAttempted = false;
  let routineCaptureRequested = false;

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
    return WorkoutForms.hasSubmissionConfiguration(FORM_CONFIGURATION);
  }

  function showSetupWarnings() {
    const problems = [];

    if (!WorkoutAuth.hasConfiguredGoogleClientIdentifier()) {
      problems.push("<code>googleClientId</code> is not set - Google sign-in is disabled.");
    }

    if (!hasFormConfig()) {
      problems.push("The Google Form <code>actionUrl</code> / entry IDs are not set - workouts cannot be submitted.");
    }

    if (!WorkoutRoutines.isConfigured()) {
      problems.push("The separate <code>configurationForm</code> is not set - shared routines cannot be saved or loaded.");
    }

    const box = $("#setup-warning");

    if (problems.length) {
      box.innerHTML = "<strong>Setup required</strong> (edit <code>fitness/config.js</code>):<ul>" +
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
    updateRoutineButtons();

    if (WorkoutRoutines.isConfigured()) {
      if (!routinesLoaded && !routinesBusy && !automaticRoutineLoadAttempted) {
        automaticRoutineLoadAttempted = true;
        loadSharedRoutines();
      }
    } else {
      setRoutineStatus("Shared routines aren't set up, so only workouts typed here can be logged.");
    }

    renderHistory();
    updateQueueUi();
    retryQueue();
  }

  function hideTracker() {
    currentUser = null;
    sharedRoutines = new Map();
    routinesLoaded = false;
    refreshRoutineList();
    refreshExerciseNames();
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
  function fillPerceivedExertionOptions(select) {
    select.replaceChildren(...Object.entries(PERCEIVED_EXERTION_LABELS).map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${value} · ${label}`;

      return option;
    }));
  }

  function showSetNotes(setElement, focus = false) {
    $(".notes-field", setElement).hidden = false;
    $(".set-add-note", setElement).hidden = true;

    if (focus) {
      $(".set-notes", setElement).focus();
    }
  }

  function renumberSets(exerciseElement) {
    $$(".set", exerciseElement).forEach((setElement, setIndex) => {
      $(".set-no", setElement).textContent = setIndex + 1;
    }, "Saving routine…");
  }

  function setWeightInput(setElement, weightKg) {
    const input = $(".set-weight", setElement);
    input.value = weightKg == null ? "" : Number(WorkoutSettings.weightFromKg(weightKg).toFixed(4));
    input.dataset.weightKg = weightKg == null ? "" : String(weightKg);
    input.dataset.displayedWeight = input.value;
    $(".weight-label", setElement).textContent = `Weight (${WorkoutSettings.weightUnit})`;
  }

  function readWeightInput(input, units = WorkoutSettings.units) {
    if (input.value === "") {
      return null;
    }

    // Keep the original kilograms when only the rounded display has changed units.
    return input.value === input.dataset.displayedWeight
      ? Number(input.dataset.weightKg)
      : WorkoutSettings.weightToKg(Number(input.value), units);
  }

  function addSet(exerciseElement, data = {}) {
    const setElement = $("#set-template").content.firstElementChild.cloneNode(true);
    $(".set-reps", setElement).value = data.reps ?? "";
    $(".set-time", setElement).value = data.durationSeconds != null ? formatDuration(data.durationSeconds) : "";
    setWeightInput(setElement, data.weightKg);
    fillPerceivedExertionOptions($(".set-rpe", setElement));
    $(".set-rpe", setElement).value = data.rpe ?? 5;
    $(".set-notes", setElement).value = data.notes ?? "";

    if (data.notes) {
      showSetNotes(setElement);
    }

    $(".sets", exerciseElement).appendChild(setElement);
    renumberSets(exerciseElement);

    return setElement;
  }

  function addExercise(data = {}) {
    const exerciseElement = $("#exercise-template").content.firstElementChild.cloneNode(true);
    $(".ex-name", exerciseElement).value = data.name ?? "";
    const measure = data.measure == null ? WorkoutSettings.defaultMeasure
      : data.measure === "time" ? "time" : "reps";
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

            return {
              reps: measure === "reps" && repetitionCount !== "" ? Number(repetitionCount) : null,
              durationSeconds: measure === "time" ? parseDuration($(".set-time", setElement).value) : null,
              weightKg: readWeightInput($(".set-weight", setElement)),
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
    $("#workout-date").value = workout.date || WORKOUT_UTILITIES.getLocalDateString();
    $("#routine-name").value = workout.routine || "";
    routineCaptureRequested = false;
    refreshRoutineList();
    $("#session-notes").value = workout.sessionNotes || "";
    $("#exercises").innerHTML = "";
    (workout.exercises && workout.exercises.length ? workout.exercises : [{}]).forEach(addExercise);
    refreshExerciseNames();
    updateEstimate();
  }

  // ---------- drafts & shared configurations ----------
  let draftTimer = null;
  let clearedWorkout = null;

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

  function applyRoutineCatalog(catalog) {
    sharedRoutines = catalog.routines;
    routinesLoaded = true;
    refreshRoutineList();
    refreshExerciseNames();
    setRoutineStatus(
      `Loaded ${sharedRoutines.size} shared routine${sharedRoutines.size === 1 ? "" : "s"}. ` +
      catalog.warnings.join(" "),
      catalog.warnings.length ? "error" : "ok"
    );
  }

  function setRoutineStatus(message, kind = "") {
    $("#routine-status").textContent = message;
    $("#routine-status").className = `status ${kind}`;
  }

  function updateRoutineButtons() {
    const unavailable = routinesBusy || !currentUser || !WorkoutRoutines.isConfigured();
    $("#refresh-routines").disabled = unavailable;
    $("#save-routine").disabled = unavailable;
    $("#routine-select").disabled = unavailable || !routinesLoaded;
    $("#export-routine").disabled = routinesBusy || !routinesLoaded;
  }

  async function runRoutineAction(action, pendingMessage = "Loading shared routines…") {
    if (routinesBusy || !currentUser) {
      return;
    }

    const user = currentUser;
    routinesBusy = true;
    updateRoutineButtons();
    setRoutineStatus(pendingMessage);

    try {
      await action(user);
    } catch (error) {
      if (currentUser !== user) {
        return;
      }

      if (POPUP_ERROR_CODES.has(error.code)) {
        setRoutineStatus("Open Routine actions and choose Refresh routines to allow access to shared routines.");

        return;
      }

      setRoutineStatus(error.message, "error");
    } finally {
      routinesBusy = false;
      updateRoutineButtons();
    }
  }

  function loadSharedRoutines() {
    return runRoutineAction(async user => {
      const catalog = await WorkoutRoutines.load();

      if (currentUser === user) {
        applyRoutineCatalog(catalog);
      }
    });
  }

  function findRoutine(name) {
    if (sharedRoutines.has(name)) {
      return sharedRoutines.get(name);
    }

    const lower = name.toLowerCase();

    return [...sharedRoutines.values()].find(routine => routine.name.toLowerCase() === lower) || null;
  }

  function loadRoutine(name) {
    const routine = findRoutine(name);

    if (!routine) {
      setRoutineStatus(`No loaded routine called "${name}". Use Refresh routines to update the list.`, "error");

      return;
    }

    renderWorkout({ date: $("#workout-date").value, routine: routine.name, exercises: routine.exercises });
    setRoutineStatus(`Loaded "${routine.name}", saved by ${routine.savedBy}. ` +
      `Estimated time: ${formatEstimate(routine.estimatedSeconds)}.`, "ok");
  }

  function refreshRoutineList() {
    const routineName = $("#routine-name").value;
    const routineSelect = $("#routine-select");
    routineSelect.innerHTML = '<option value="" disabled>Choose a routine</option>' +
      [...sharedRoutines.keys()].sort()
        .map(name => `<option value="${escapeMarkup(name)}">${escapeMarkup(name)}</option>`).join("") +
      '<option value="" data-capture-new="true">Capture new</option>';
    routineSelect.value = sharedRoutines.has(routineName) ? routineName : "";
    setRoutineCaptureMode(routineCaptureRequested || !sharedRoutines.size ||
      Boolean(routineName && !sharedRoutines.has(routineName)));
  }

  function setRoutineCaptureMode(captureActive) {
    $("#routine-select").hidden = captureActive;
    $("#routine-capture").hidden = !captureActive;
    $("#choose-saved-routine").hidden = !captureActive || !sharedRoutines.size;
    $("#routine-label").htmlFor = captureActive ? "routine-name" : "routine-select";
    updateRoutineButtons();
  }

  function exportRoutines() {
    const routines = [...sharedRoutines.values()].map(routine => ({
      name: routine.name, exercises: routineTemplate(routine)
    }));
    const json = JSON.stringify({ routines }, null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "routines.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function refreshExerciseNames() {
    const names = new Set();
    sharedRoutines.forEach(routine => routine.exercises.forEach(exercise => names.add(exercise.name)));
    $$("#exercises .ex-name").forEach(input => input.value.trim() && names.add(input.value.trim()));
    $("#exercise-names").innerHTML = [...names].sort()
      .map(exerciseName => `<option value="${escapeMarkup(exerciseName)}"></option>`).join("");
  }

  // ---------- status ----------
  function setStatus(message, kind = "") {
    SUBMISSION_STATUS.set($("#status"), message, kind);
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
    $("#retry-queue").disabled = flushing || !currentUser || !hasFormConfig();
  }

  async function postToForm(row) {
    if (!currentUser) {
      throw new Error("Sign in before submitting workout data.");
    }

    await WorkoutForms.postRow(FORM_CONFIGURATION, row);
  }

  async function flushQueue() {
    if (!currentUser) {
      return false;
    }

    if (flushing || !hasFormConfig()) {
      return readQueue().length === 0;
    }

    flushing = true;
    updateQueueUi();

    try {
      let next;

      while ((next = readQueue()[0])) {
        await postToForm(next);
        writeQueue(readQueue().filter(queueRow => queueRow.id !== next.id));
        updateQueueUi();
      }

      return true;
    } catch (error) {
      console.error("Could not send queued workouts.", error);

      return false;
    } finally {
      flushing = false;
      updateQueueUi();
    }
  }

  async function retryQueue() {
    if (!currentUser || !hasFormConfig() || flushing || !readQueue().length) {
      return;
    }

    setStatus(SUBMISSION_STATUS.retrying("workout"));
    const sent = await flushQueue();
    setStatus(sent
      ? SUBMISSION_STATUS.retrySent("workout")
      : SUBMISSION_STATUS.retryQueued("workout"),
    sent ? "ok" : "error");
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

  function validate(workout, { requireDate = true } = {}) {
    if (requireDate && !workout.date) {
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
    setStatus(SUBMISSION_STATUS.submitting("workout"));
    const sent = await flushQueue();
    $("#submit-workout").disabled = false;
    renderWorkout({ routine: workout.routine, exercises: routineTemplate(workout) });
    localStorage.removeItem(STORAGE_KEYS.draft);
    renderHistory();
    setStatus(sent
      ? `${SUBMISSION_STATUS.sent("workout")} (${rows.length} set${rows.length === 1 ? "" : "s"}).`
      : SUBMISSION_STATUS.queued("workout"),
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
    document.addEventListener("workout:unitschange", event => {
      $$("#exercises .set").forEach(setElement => {
        const weightKg = readWeightInput($(".set-weight", setElement), event.detail.previousUnits);
        setWeightInput(setElement, weightKg);
      });
    });

    const form = $("#workout-form");
    form.addEventListener("submit", submitWorkout);
    form.addEventListener("input", () => {
      $("#undo-clear").hidden = true;
      clearedWorkout = null;
      saveDraft();
    });
    form.addEventListener("change", event => {
      const target = event.target;

      if (target.id === "routine-select") {
        const captureNew = target.selectedOptions[0].dataset.captureNew === "true";
        $("#routine-name").value = captureNew ? "" : target.value;
        routineCaptureRequested = captureNew;
        setRoutineCaptureMode(captureNew);

        if (captureNew) {
          $("#routine-name").focus();
        } else {
          loadRoutine(target.value);
        }
      }

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
      } else if (button.classList.contains("set-add-note")) {
        showSetNotes(setElement, true);

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

    $("#refresh-routines").addEventListener("click", loadSharedRoutines);

    $("#clear-routine-name").addEventListener("click", () => {
      $("#routine-name").value = "";
      $("#routine-name").dispatchEvent(new Event("input", { bubbles: true }));
      $("#routine-name").focus();
    });

    $("#choose-saved-routine").addEventListener("click", () => {
      $("#routine-name").value = "";
      $("#routine-select").value = "";
      routineCaptureRequested = false;
      setRoutineCaptureMode(false);
      $("#routine-select").dispatchEvent(new Event("input", { bubbles: true }));
      $("#routine-select").focus();
    });

    $("#save-routine").addEventListener("click", () => {
      $$(".set").forEach(stopTimer);
      const workout = collectWorkout();
      const error = !workout.routine ? "Enter a unique workout name first." : validate(workout, { requireDate: false });

      if (error) {
        setRoutineStatus(error, "error");

        return;
      }

      runRoutineAction(async user => {
        const catalog = await WorkoutRoutines.save({
          name: workout.routine, exercises: routineTemplate(workout)
        }, estimateSeconds(workout));

        if (currentUser === user) {
          applyRoutineCatalog(catalog);
          setRoutineStatus(`Saved routine "${workout.routine}" by ${user.email}. ` +
            `Estimated time: ${formatEstimate(estimateSeconds(workout))}. ` + catalog.warnings.join(" "),
            catalog.warnings.length ? "error" : "ok");
        }
      });
    });

    $("#export-routine").addEventListener("click", () => {
      exportRoutines();
      setRoutineStatus(`Exported ${sharedRoutines.size} loaded routines in the routines.json format.`, "ok");
    });

    $("#clear-workout").addEventListener("click", () => {
      $$(".set").forEach(stopTimer);
      clearedWorkout = collectWorkout();
      clearTimeout(draftTimer);
      renderWorkout({});
      localStorage.removeItem(STORAGE_KEYS.draft);
      setStatus("Workout cleared.");
      $("#undo-clear").hidden = false;
      $("#undo-clear").focus();
    });

    $("#undo-clear").addEventListener("click", () => {
      if (!clearedWorkout) {
        return;
      }

      renderWorkout(clearedWorkout);
      clearedWorkout = null;
      saveDraft();
      $("#undo-clear").hidden = true;
      setStatus("Workout restored.", "ok");
      $("#clear-workout").focus();
    });

    $("#routine-actions").addEventListener("click", event => {
      if (event.target.closest(".actions-panel button")) {
        $("#routine-actions").open = false;
      }
    });

    document.addEventListener("click", event => {
      if (!event.target.closest("#routine-actions")) {
        $("#routine-actions").open = false;
      }
    });

    $("#routine-actions").addEventListener("keydown", event => {
      if (event.key !== "Escape" || !$("#routine-actions").open) {
        return;
      }

      $("#routine-actions").open = false;
      $("#routine-actions summary").focus();
    });

    $("#retry-queue").addEventListener("click", retryQueue);

    window.addEventListener("online", retryQueue);
  }

  // ---------- boot ----------
  function boot() {
    showSetupWarnings();
    wireEvents();
    renderWorkout(readJson(localStorage, STORAGE_KEYS.draft, {}));
    updateRoutineButtons();
    WorkoutAuth.init({ onSignIn: showTracker, onSignOut: hideTracker });
  }

  boot();
})();
