(() => {
  "use strict";

  const CONFIG = window.WORKOUT_CONFIG || {};
  const FORM = CONFIG.form || {};
  const KEYS = {
    user: "workout.user",
    draft: "workout.draft",
    routines: "workout.routines",
    queue: "workout.queue",
    history: "workout.history"
  };
  const SESSION_HOURS = 12;
  const RPE_LABELS = {
    1: "Very light", 2: "Light", 3: "Light", 4: "Moderate", 5: "Moderate",
    6: "Moderate+", 7: "Hard", 8: "Hard+", 9: "Very hard", 10: "Max effort"
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let currentUser = null;
  let googleInitialized = false;
  let flushing = false;

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
  function hasClientId() {
    return typeof CONFIG.googleClientId === "string" && CONFIG.googleClientId.trim() !== "";
  }
  function hasFormConfig() {
    const fields = FORM.fields || {};
    return typeof FORM.actionUrl === "string" &&
      /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(FORM.actionUrl) &&
      Object.values(fields).some(v => /^entry\.\d+$/.test(v));
  }

  function showSetupWarnings() {
    const problems = [];
    if (!hasClientId()) problems.push("<code>googleClientId</code> is not set - Google sign-in is disabled.");
    if (!hasFormConfig()) problems.push("The Google Form <code>actionUrl</code> / entry IDs are not set - workouts cannot be submitted.");
    const box = $("#setup-warning");
    if (problems.length) {
      box.innerHTML = "<strong>Setup required</strong> (edit <code>workouts/config.js</code>):<ul>" +
        problems.map(p => `<li>${p}</li>`).join("") + "</ul>";
      box.hidden = false;
    }
  }

  // ---------- authentication ----------
  function decodeJwt(token) {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function isAllowed(email) {
    const list = (CONFIG.allowedEmails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
    return list.length === 0 || list.includes(email.toLowerCase());
  }

  function showLoginError(message) {
    $("#login-error").textContent = message;
  }

  // Global so it can also be used as a GIS HTML-API data-callback.
  window.handleCredentialResponse = function (response) {
    let payload;
    try {
      payload = decodeJwt(response.credential);
    } catch {
      showLoginError("Could not read the Google sign-in response.");
      return;
    }
    const issuerOk = payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com";
    if (!issuerOk || payload.aud !== CONFIG.googleClientId) {
      showLoginError("Sign-in response was not issued for this site.");
      return;
    }
    if (!payload.email || payload.email_verified === false) {
      showLoginError("Your Google account email is not verified.");
      return;
    }
    if (payload.exp * 1000 < Date.now()) {
      showLoginError("Sign-in expired, please try again.");
      return;
    }
    if (!isAllowed(payload.email)) {
      showLoginError(`${payload.email} is not authorised to use this tracker.`);
      if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
      return;
    }
    const user = {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || "",
      expiresAt: Date.now() + SESSION_HOURS * 3600 * 1000
    };
    writeJson(sessionStorage, KEYS.user, user);
    showLoginError("");
    showTracker(user);
  };

  function restoreUser() {
    const user = readJson(sessionStorage, KEYS.user, null);
    if (user && user.expiresAt > Date.now() && isAllowed(user.email)) return user;
    sessionStorage.removeItem(KEYS.user);
    return null;
  }

  function initGoogle() {
    if (googleInitialized || !hasClientId() || !window.google?.accounts?.id) return;
    googleInitialized = true;
    google.accounts.id.initialize({
      client_id: CONFIG.googleClientId,
      callback: window.handleCredentialResponse,
      auto_select: true,
      cancel_on_tap_outside: true
    });
    google.accounts.id.renderButton($("#google-signin-button"), {
      theme: "filled_blue", size: "large", shape: "pill", text: "signin_with"
    });
    if (!currentUser) google.accounts.id.prompt();
  }

  function signOut() {
    sessionStorage.removeItem(KEYS.user);
    currentUser = null;
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    $("#tracker-view").hidden = true;
    $("#user-box").hidden = true;
    $("#login-view").hidden = false;
  }

  function showTracker(user) {
    currentUser = user;
    $("#login-view").hidden = true;
    $("#tracker-view").hidden = false;
    $("#user-box").hidden = false;
    $("#user-name").textContent = user.name;
    const avatar = $("#user-avatar");
    avatar.hidden = !user.picture;
    if (user.picture) avatar.src = user.picture;
    $("#submit-workout").disabled = !hasFormConfig();
    refreshRoutineList();
    renderHistory();
    updateQueueUi();
    flushQueue();
  }

  // ---------- duration helpers ----------
  function parseDuration(text) {
    const value = String(text || "").trim();
    if (!value) return null;
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    const match = value.match(/^(?:(\d+):)?(\d+):(\d{1,2})$/);
    if (!match) return NaN;
    const [, h, m, s] = match;
    return (parseInt(h || "0", 10) * 3600) + parseInt(m, 10) * 60 + parseInt(s, 10);
  }
  function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ---------- workout DOM ----------
  function todayIso() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function updateRpeLabel(setEl) {
    const value = $(".set-rpe", setEl).value;
    $(".rpe-out", setEl).textContent = `${value} · ${RPE_LABELS[value]}`;
  }

  function renumberSets(exerciseEl) {
    $$(".set", exerciseEl).forEach((setEl, i) => {
      $(".set-no", setEl).textContent = i + 1;
    });
  }

  function addSet(exerciseEl, data = {}) {
    const setEl = $("#set-template").content.firstElementChild.cloneNode(true);
    $(".set-reps", setEl).value = data.reps ?? "";
    $(".set-time", setEl).value = data.durationSeconds != null ? formatDuration(data.durationSeconds) : "";
    $(".set-weight", setEl).value = data.weightKg ?? "";
    $(".set-rpe", setEl).value = data.rpe ?? 5;
    $(".set-notes", setEl).value = data.notes ?? "";
    updateRpeLabel(setEl);
    $(".sets", exerciseEl).appendChild(setEl);
    renumberSets(exerciseEl);
    return setEl;
  }

  function addExercise(data = {}) {
    const exEl = $("#exercise-template").content.firstElementChild.cloneNode(true);
    $(".ex-name", exEl).value = data.name ?? "";
    const measure = data.measure === "time" ? "time" : "reps";
    $(".ex-measure", exEl).value = measure;
    exEl.dataset.measure = measure;
    const sets = data.sets && data.sets.length ? data.sets : [{}];
    sets.forEach(s => addSet(exEl, s));
    $("#exercises").appendChild(exEl);
    return exEl;
  }

  function stopTimer(setEl) {
    if (setEl._timer) {
      clearInterval(setEl._timer);
      setEl._timer = null;
      const btn = $(".set-timer", setEl);
      btn.innerHTML = "&#9654;";
      btn.classList.remove("running");
      saveDraft();
    }
  }

  function toggleTimer(setEl) {
    if (setEl._timer) {
      stopTimer(setEl);
      return;
    }
    $$(".set").forEach(stopTimer);
    const input = $(".set-time", setEl);
    const base = parseDuration(input.value) || 0;
    const start = Date.now();
    const btn = $(".set-timer", setEl);
    btn.innerHTML = "&#9632;";
    btn.classList.add("running");
    setEl._timer = setInterval(() => {
      input.value = formatDuration(base + Math.floor((Date.now() - start) / 1000));
    }, 250);
  }

  function collectWorkout() {
    return {
      date: $("#workout-date").value,
      routine: $("#routine-name").value.trim(),
      sessionNotes: $("#session-notes").value.trim(),
      exercises: $$("#exercises .exercise").map(exEl => {
        const measure = $(".ex-measure", exEl).value;
        return {
          name: $(".ex-name", exEl).value.trim(),
          measure,
          sets: $$(".set", exEl).map(setEl => {
            const reps = $(".set-reps", setEl).value;
            const weight = $(".set-weight", setEl).value;
            return {
              reps: measure === "reps" && reps !== "" ? Number(reps) : null,
              durationSeconds: measure === "time" ? parseDuration($(".set-time", setEl).value) : null,
              weightKg: weight !== "" ? Number(weight) : null,
              rpe: Number($(".set-rpe", setEl).value),
              notes: $(".set-notes", setEl).value.trim()
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
  }

  // ---------- drafts & routines ----------
  let draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => writeJson(localStorage, KEYS.draft, collectWorkout()), 300);
  }

  function routineTemplate(workout) {
    return workout.exercises
      .filter(ex => ex.name)
      .map(ex => ({
        name: ex.name,
        measure: ex.measure,
        sets: ex.sets.map(s => ({ reps: s.reps, durationSeconds: s.durationSeconds, weightKg: s.weightKg, rpe: 5 }))
      }));
  }

  function saveRoutine(name, workout) {
    const exercises = routineTemplate(workout);
    if (!name || !exercises.length) return false;
    const routines = readJson(localStorage, KEYS.routines, {});
    routines[name] = exercises;
    writeJson(localStorage, KEYS.routines, routines);
    refreshRoutineList();
    return true;
  }

  function refreshRoutineList() {
    const routines = readJson(localStorage, KEYS.routines, {});
    $("#routine-list").innerHTML = Object.keys(routines).sort()
      .map(n => `<option value="${escapeHtml(n)}"></option>`).join("");
  }

  function refreshExerciseNames() {
    const names = new Set();
    Object.values(readJson(localStorage, KEYS.routines, {})).forEach(exs => exs.forEach(ex => names.add(ex.name)));
    $$("#exercises .ex-name").forEach(input => input.value.trim() && names.add(input.value.trim()));
    $("#exercise-names").innerHTML = [...names].sort()
      .map(n => `<option value="${escapeHtml(n)}"></option>`).join("");
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- status ----------
  function setStatus(message, kind = "") {
    const el = $("#status");
    el.textContent = message;
    el.className = `status ${kind}`;
  }

  // ---------- Google Forms submission ----------
  function readQueue() { return readJson(localStorage, KEYS.queue, []); }
  function writeQueue(queue) { writeJson(localStorage, KEYS.queue, queue); }

  function updateQueueUi() {
    const count = readQueue().length;
    $("#queue-box").hidden = count === 0;
    $("#queue-text").textContent = `${count} set${count === 1 ? "" : "s"} waiting to be sent.`;
  }

  async function postToForm(row) {
    const body = new URLSearchParams();
    for (const [key, entry] of Object.entries(FORM.fields || {})) {
      const value = row[key];
      if (entry && value !== null && value !== undefined && value !== "") body.append(entry, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // Google Forms does not send CORS headers, so the response is opaque; only network failures are detectable.
      await fetch(FORM.actionUrl, { method: "POST", mode: "no-cors", body, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function flushQueue() {
    if (flushing || !hasFormConfig()) return readQueue().length === 0;
    flushing = true;
    try {
      let next;
      while ((next = readQueue()[0])) {
        await postToForm(next);
        writeQueue(readQueue().filter(r => r.id !== next.id));
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
    workout.exercises.forEach((ex, exIndex) => {
      ex.sets.forEach((set, setIndex) => {
        rows.push({
          id: `${sessionId}:${exIndex}:${setIndex}`,
          email: currentUser.email,
          sessionId,
          date: workout.date,
          routine: workout.routine,
          exercise: ex.name,
          exerciseOrder: exIndex + 1,
          setNumber: setIndex + 1,
          measure: ex.measure,
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
    if (!workout.date) return "Please choose a date.";
    if (!workout.exercises.length) return "Add at least one exercise.";
    for (const [i, ex] of workout.exercises.entries()) {
      if (!ex.name) return `Exercise ${i + 1} needs a name.`;
      if (!ex.sets.length) return `${ex.name} has no sets.`;
      for (const [j, s] of ex.sets.entries()) {
        if (ex.measure === "reps" && (s.reps === null || !Number.isFinite(s.reps) || s.reps < 0)) {
          return `${ex.name}, set ${j + 1}: enter the number of reps.`;
        }
        if (ex.measure === "time" && (s.durationSeconds === null || Number.isNaN(s.durationSeconds))) {
          return `${ex.name}, set ${j + 1}: enter a time such as 0:45 or 45.`;
        }
      }
    }
    return null;
  }

  async function submitWorkout(event) {
    event.preventDefault();
    if (!currentUser) return;
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

    const history = readJson(localStorage, KEYS.history, []);
    const rpes = rows.map(r => r.rpe);
    history.unshift({
      sessionId,
      date: workout.date,
      routine: workout.routine,
      exercises: workout.exercises.map(ex => `${ex.name} ×${ex.sets.length}`),
      avgRpe: Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10
    });
    writeJson(localStorage, KEYS.history, history.slice(0, 20));
    if (workout.routine) saveRoutine(workout.routine, workout);

    $("#submit-workout").disabled = true;
    setStatus("Sending…");
    const sent = await flushQueue();
    $("#submit-workout").disabled = false;

    renderWorkout({ routine: workout.routine, exercises: routineTemplate(workout) });
    localStorage.removeItem(KEYS.draft);
    renderHistory();
    setStatus(sent
      ? `Workout saved (${rows.length} set${rows.length === 1 ? "" : "s"}).`
      : "You appear to be offline. The workout is saved on this device and will be sent automatically.",
      sent ? "ok" : "error");
  }

  function renderHistory() {
    const history = readJson(localStorage, KEYS.history, []);
    $("#history").innerHTML = history.length
      ? history.map(h => `<li><strong>${escapeHtml(h.date)}</strong> ${escapeHtml(h.routine || "Workout")}
          <span class="muted">· avg difficulty ${h.avgRpe}</span><br>
          <span class="muted">${h.exercises.map(escapeHtml).join(", ")}</span></li>`).join("")
      : `<li class="muted">No workouts logged yet.</li>`;
  }

  // ---------- event wiring ----------
  function wireEvents() {
    const form = $("#workout-form");
    form.addEventListener("submit", submitWorkout);
    form.addEventListener("input", event => {
      if (event.target.classList.contains("set-rpe")) updateRpeLabel(event.target.closest(".set"));
      saveDraft();
    });
    form.addEventListener("change", event => {
      const target = event.target;
      if (target.classList.contains("ex-measure")) {
        target.closest(".exercise").dataset.measure = target.value;
      }
      if (target.classList.contains("set-time")) {
        const seconds = parseDuration(target.value);
        if (seconds !== null && !Number.isNaN(seconds)) target.value = formatDuration(seconds);
      }
      if (target.classList.contains("ex-name")) refreshExerciseNames();
      saveDraft();
    });
    form.addEventListener("click", event => {
      const btn = event.target.closest("button");
      if (!btn) return;
      const exEl = btn.closest(".exercise");
      const setEl = btn.closest(".set");
      if (btn.classList.contains("ex-add-set")) {
        const sets = collectWorkout().exercises[$$("#exercises .exercise").indexOf(exEl)].sets;
        const last = sets[sets.length - 1] || {};
        addSet(exEl, { ...last, notes: "" });
      } else if (btn.classList.contains("set-remove")) {
        stopTimer(setEl);
        if ($$(".set", exEl).length > 1) {
          setEl.remove();
          renumberSets(exEl);
        }
      } else if (btn.classList.contains("ex-remove")) {
        $$(".set", exEl).forEach(stopTimer);
        exEl.remove();
        if (!$$("#exercises .exercise").length) addExercise();
      } else if (btn.classList.contains("set-timer")) {
        toggleTimer(setEl);
        return;
      } else {
        return;
      }
      saveDraft();
    });

    $("#add-exercise").addEventListener("click", () => {
      const exEl = addExercise();
      $(".ex-name", exEl).focus();
      saveDraft();
    });

    $("#load-routine").addEventListener("click", () => {
      const name = $("#routine-name").value.trim();
      const routines = readJson(localStorage, KEYS.routines, {});
      if (!routines[name]) {
        setStatus(name ? `No saved routine called "${name}".` : "Type or pick a routine name first.", "error");
        return;
      }
      renderWorkout({ date: $("#workout-date").value, routine: name, exercises: routines[name] });
      saveDraft();
      setStatus(`Loaded routine "${name}".`, "ok");
    });

    $("#save-routine").addEventListener("click", () => {
      const name = $("#routine-name").value.trim();
      if (!name) {
        setStatus("Enter a routine name first.", "error");
        return;
      }
      const saved = saveRoutine(name, collectWorkout());
      setStatus(saved ? `Routine "${name}" saved.` : "Add at least one named exercise before saving.",
        saved ? "ok" : "error");
      refreshExerciseNames();
    });

    $("#clear-workout").addEventListener("click", () => {
      if (!confirm("Clear the current workout?")) return;
      renderWorkout({});
      localStorage.removeItem(KEYS.draft);
      setStatus("");
    });

    $("#retry-queue").addEventListener("click", async () => {
      setStatus("Sending…");
      const sent = await flushQueue();
      setStatus(sent ? "All pending sets sent." : "Still offline - will retry automatically.", sent ? "ok" : "error");
    });

    $("#sign-out").addEventListener("click", signOut);
    window.addEventListener("online", () => currentUser && flushQueue());
  }

  // ---------- boot ----------
  function boot() {
    showSetupWarnings();
    wireEvents();
    renderWorkout(readJson(localStorage, KEYS.draft, {}));

    const user = restoreUser();
    if (user) showTracker(user);

    if (window.google?.accounts?.id) initGoogle();
    else window.onGoogleLibraryLoad = initGoogle;
  }

  boot();
})();
