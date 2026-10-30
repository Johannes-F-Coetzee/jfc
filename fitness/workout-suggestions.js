// Suggests the next workout on the Log page from a saved plan. Plans come from the plan form (see plans.js) and the
// account's logged workouts from the workout form (see logged-workouts.js); workouts already logged close to their
// scheduled day are not suggested. The Log page supplies the host callbacks in init().
(() => {
  "use strict";

  const { html, setHtml, getLocalDateString } = window.WorkoutUtilities;
  const ACTIVE_PLAN_STORAGE_KEY = "workout.activePlan";
  const POPUP_ERROR_CODES = new Set(["popup_failed_to_open", "popup_closed"]);
  const $ = selector => document.querySelector(selector);

  let host = { getDate: () => "", getLoggedWorkouts: () => [], hasRoutine: () => false, loadRoutine() {} };
  let currentUser = null;
  let accountVersion = 0;
  let loading = false;
  let plansByName = new Map();
  let remoteLoggedWorkouts = [];
  let activePlanName = "";

  function setStatus(message, kind = "") {
    $("#plan-suggestion-status").textContent = message;
    $("#plan-suggestion-status").className = `status ${kind}`;
  }

  function readActivePlanName() {
    try {
      return localStorage.getItem(`${ACTIVE_PLAN_STORAGE_KEY}:${currentUser.email}`) || "";
    } catch (error) {
      console.error("Could not read the selected plan.", error);

      return "";
    }
  }

  function writeActivePlanName(name) {
    try {
      localStorage.setItem(`${ACTIVE_PLAN_STORAGE_KEY}:${currentUser.email}`, name);
    } catch (error) {
      console.error("Could not remember the selected plan on this device.", error);
    }
  }

  function updateControls() {
    const unavailable = !currentUser || !WorkoutPlans.isConfigured();
    $("#refresh-plans").disabled = unavailable || loading;
    $("#suggestion-plan-select").disabled = unavailable || !plansByName.size;
  }

  function renderPlanOptions() {
    const select = $("#suggestion-plan-select");
    setHtml(select, html`<option value="">No plan</option>${
      [...plansByName.keys()].sort().map(name => html`<option value="${name}">${name}</option>`)}`);
    select.value = plansByName.has(activePlanName) ? activePlanName : "";
  }

  function formatScheduledDate(dateString) {
    return new Date(`${dateString}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: "short", day: "numeric", month: "short", timeZone: "UTC"
    });
  }

  function describeSuggestion(suggestion) {
    return suggestion.overdue
      ? `Missed: scheduled ${formatScheduledDate(suggestion.scheduledDate)}`
      : "Scheduled for this date";
  }

  function renderSuggestions() {
    const list = $("#suggestion-list");
    const plan = currentUser ? plansByName.get(activePlanName) : null;

    if (!plan) {
      setHtml(list, html`<li class="muted">${plansByName.size
        ? "Choose a plan to see what to log."
        : "Save a plan on the Plan page to get workout suggestions."}</li>`);

      return;
    }

    const date = host.getDate() || getLocalDateString();
    const { state, suggestions } = WorkoutPlanSchedule.suggest(plan, date,
      host.getLoggedWorkouts().concat(remoteLoggedWorkouts));

    if (!suggestions.length) {
      const messages = {
        "not-started": `"${plan.name}" starts on ${plan.startDate}.`,
        "all-logged": "Everything scheduled around this date is already logged.",
        "nothing-scheduled": "Rest day: nothing is scheduled around this date."
      };
      setHtml(list, html`<li class="muted">${messages[state]}</li>`);

      return;
    }

    setHtml(list, suggestions.map(suggestion => html`<li>
      <button type="button" class="btn secondary small" data-routine="${suggestion.routine}"
        ${host.hasRoutine(suggestion.routine) ? "" : "disabled"}>Load ${suggestion.routine}</button>
      <span class="muted">${describeSuggestion(suggestion)}${host.hasRoutine(suggestion.routine)
        ? "" : " · routine not loaded yet"}</span></li>`));
  }

  async function loadLoggedWorkouts(version) {
    if (!WorkoutLog.isConfigured()) {
      return "Suggestions only consider workouts logged on this device.";
    }

    try {
      const workouts = await WorkoutLog.load();

      if (version === accountVersion) {
        remoteLoggedWorkouts = workouts;
      }

      return "";
    } catch (error) {
      console.error("Could not read logged workouts.", error);

      return "Suggestions only consider workouts logged on this device.";
    }
  }

  async function loadPlans() {
    if (loading || !currentUser || !WorkoutPlans.isConfigured()) {
      return;
    }

    const version = accountVersion;
    loading = true;
    updateControls();
    setStatus("Loading your plans…");

    try {
      const catalog = await WorkoutPlans.load();

      if (version !== accountVersion) {
        return;
      }

      plansByName = new Map([...catalog.plans.values()].map(plan => [plan.name, plan]));
      activePlanName = plansByName.has(activePlanName) ? activePlanName : readActivePlanName();
      renderPlanOptions();
      renderSuggestions();
      const loggedNote = await loadLoggedWorkouts(version);

      if (version !== accountVersion) {
        return;
      }

      renderSuggestions();
      setStatus([`Loaded ${plansByName.size} plan${plansByName.size === 1 ? "" : "s"}.`,
        ...catalog.warnings, loggedNote].filter(Boolean).join(" "),
      catalog.warnings.length ? "error" : "ok");
    } catch (error) {
      if (version !== accountVersion) {
        return;
      }

      console.error("Could not load plans.", error);
      setStatus(POPUP_ERROR_CODES.has(error.code)
        ? "Choose Refresh plans to allow access to your saved plans."
        : `Could not load plans: ${error.message}`, POPUP_ERROR_CODES.has(error.code) ? "" : "error");
    } finally {
      if (version === accountVersion) {
        loading = false;
        updateControls();
      }
    }
  }

  function signedIn(user) {
    if (currentUser?.email === user.email) {
      return;
    }

    accountVersion += 1;
    currentUser = user;
    loading = false;
    plansByName = new Map();
    remoteLoggedWorkouts = [];
    activePlanName = readActivePlanName();
    renderPlanOptions();
    renderSuggestions();
    updateControls();

    if (WorkoutPlans.isConfigured()) {
      loadPlans();
    } else {
      setStatus("Plans aren't set up, so there are no workout suggestions.");
    }
  }

  function signedOut() {
    accountVersion += 1;
    currentUser = null;
    loading = false;
    plansByName = new Map();
    remoteLoggedWorkouts = [];
    activePlanName = "";
    setStatus("");
    renderSuggestions();
    updateControls();
  }

  function init(hostCallbacks) {
    host = { ...host, ...hostCallbacks };
    $("#refresh-plans").addEventListener("click", loadPlans);
    $("#suggestion-plan-select").addEventListener("change", event => {
      activePlanName = event.target.value;
      writeActivePlanName(activePlanName);
      renderSuggestions();
    });
    $("#suggestion-list").addEventListener("click", event => {
      const button = event.target.closest("button[data-routine]");

      if (button) {
        host.loadRoutine(button.dataset.routine);
      }
    });
  }

  window.WorkoutSuggestions = { init, signedIn, signedOut, refresh: renderSuggestions };
})();
