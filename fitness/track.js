(() => {
  "use strict";

  const FIELD_DEFINITIONS = [
    { key: "neck", label: "Neck", kind: "number", unit: "length" },
    { key: "bicepL", label: "Bicep L", kind: "number", unit: "length" },
    { key: "bicepR", label: "Bicep R", kind: "number", unit: "length" },
    { key: "forearmL", label: "Forearm L", kind: "number", unit: "length" },
    { key: "forearmR", label: "Forearm R", kind: "number", unit: "length" },
    { key: "shoulders", label: "Shoulders", kind: "number", unit: "length" },
    { key: "chest", label: "Chest", kind: "number", unit: "length" },
    { key: "waist", label: "Waist", kind: "number", unit: "length" },
    { key: "belly", label: "Belly", kind: "number", unit: "length" },
    { key: "butt", label: "Butt", kind: "number", unit: "length" },
    { key: "thighL", label: "Thigh L", kind: "number", unit: "length" },
    { key: "thighR", label: "Thigh R", kind: "number", unit: "length" },
    { key: "calfL", label: "Calf L", kind: "number", unit: "length" },
    { key: "calfR", label: "Calf R", kind: "number", unit: "length" },
    { key: "weight", label: "Weight", kind: "number", unit: "weight" },
    { key: "sleep", label: "Sleep", kind: "number", unit: "sleep" },
    { key: "water", label: "Water", kind: "number", unit: "water" },
    { key: "energy", label: "Energy", kind: "select", options: ["spent", "weak", "tired", "fair", "good", "strong"] },
    { key: "mood", label: "Mood", kind: "select", options: ["bad", "poor", "meh", "fair", "good", "great"] }
  ];
  const FIELD_GROUPS = [
    { title: "Body", layout: "single", keys: ["weight"] },
    { title: "Daily state", layout: "quad", keys: ["sleep", "water", "energy", "mood"] },
    {
      title: "Circumference",
      layout: "paired",
      keys: [
        "neck", "shoulders", "chest", "waist", "belly", "butt", "bicepL", "bicepR",
        "forearmL", "forearmR", "thighL", "thighR", "calfL", "calfR"
      ]
    }
  ];
  const STORAGE_PREFIX = "fitness.measurements.";
  const FORM_CONFIGURATION = (window.WORKOUT_CONFIG || {}).measurementsForm || {};
  const FORM_FIELD_NAMES = FIELD_DEFINITIONS.map(field => {
    if (field.unit === "length") {
      return `${field.key}Cm`;
    }

    return { weight: "weightKg", sleep: "sleepHours", water: "waterLitres" }[field.key] || field.key;
  });
  const REQUIRED_FORM_FIELDS = ["email", "measurementId", "date", ...FORM_FIELD_NAMES];
  const ACTIVE_SUBMISSIONS = new Set();
  const SUBMISSION_STATUS = window.WorkoutSubmissionStatus;
  const CENTIMETRES_PER_INCH = 2.54;
  const LITRES_PER_FLUID_OUNCE = 0.0295735295625;
  const $ = selector => document.querySelector(selector);

  let records = [];
  let storageKey = "";
  let clearedFields = null;

  function hasFormConfiguration() {
    const fields = FORM_CONFIGURATION.fields || {};
    const entries = REQUIRED_FORM_FIELDS.map(field => fields[field]);

    return /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(FORM_CONFIGURATION.actionUrl || "") &&
      entries.every(entry => /^entry\.\d+$/.test(entry || "")) &&
      new Set(entries).size === entries.length;
  }

  function localDate() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;

    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function currentUnits() {
    return window.WorkoutSettings.units;
  }

  function unitLabel(field) {
    if (field.unit === "length") {
      return currentUnits() === "imperial" ? "in" : "cm";
    }

    if (field.unit === "weight") {
      return window.WorkoutSettings.weightUnit;
    }

    if (field.unit === "sleep") {
      return "hours";
    }

    if (field.unit === "water") {
      return currentUnits() === "imperial" ? "fl oz" : "L";
    }

    return "";
  }

  function createField(field) {
    const label = document.createElement("label");
    label.className = "field";
    label.htmlFor = `measurement-${field.key}`;
    const title = document.createElement("span");
    title.textContent = field.kind === "number" ? `${field.label} (${unitLabel(field)})` : field.label;
    label.append(title);

    if (field.kind === "select") {
      const select = document.createElement("select");
      select.id = `measurement-${field.key}`;
      select.dataset.field = field.key;
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose…";
      select.append(placeholder);
      field.options.forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      });
      label.append(select);

      return label;
    }

    const input = document.createElement("input");
    input.id = `measurement-${field.key}`;
    input.dataset.field = field.key;
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.inputMode = "decimal";
    label.append(input);

    return label;
  }

  function renderFields() {
    const container = $("#measurement-fields");
    container.replaceChildren();

    FIELD_GROUPS.forEach(group => {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "measurement-group";
      const legend = document.createElement("legend");
      legend.textContent = group.title;
      const grid = document.createElement("div");
      grid.className = `measurement-grid ${group.layout}`;
      group.keys.forEach(key => grid.append(createField(FIELD_DEFINITIONS.find(field => field.key === key))));
      fieldset.append(legend, grid);
      container.append(fieldset);
    });
  }

  function toCanonical(field, value, system = currentUnits()) {
    if (field.unit === "length" && system === "imperial") {
      return value * CENTIMETRES_PER_INCH;
    }

    if (field.unit === "weight") {
      return window.WorkoutSettings.weightToKg(value, system);
    }

    if (field.unit === "water" && system === "imperial") {
      return value * LITRES_PER_FLUID_OUNCE;
    }

    return value;
  }

  function fromCanonical(field, value, system = currentUnits()) {
    if (field.unit === "length" && system === "imperial") {
      return value / CENTIMETRES_PER_INCH;
    }

    if (field.unit === "weight") {
      return window.WorkoutSettings.weightFromKg(value, system);
    }

    if (field.unit === "water" && system === "imperial") {
      return value / LITRES_PER_FLUID_OUNCE;
    }

    return value;
  }

  function collectValues(system = currentUnits()) {
    const values = {};

    FIELD_DEFINITIONS.forEach(field => {
      const value = $(`#measurement-${field.key}`).value;

      if (value !== "") {
        values[field.key] = field.kind === "number" ? toCanonical(field, Number(value), system) : value;
      }
    });

    return values;
  }

  function populateForm(record) {
    discardClearedFields();
    $("#measurement-date").value = record.date;
    FIELD_DEFINITIONS.forEach(field => {
      const input = $(`#measurement-${field.key}`);
      const value = record.values[field.key];
      input.value = value === undefined ? "" :
        field.kind === "number" ? String(Number(fromCanonical(field, value).toFixed(2))) : value;
    });
    $("#measurement-status").textContent = `Editing entry for ${record.date}.`;
    $("#measurement-status").className = "status";
    $("#measurement-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function formatValue(field, value) {
    if (field.kind === "select") {
      return value;
    }

    const displayValue = fromCanonical(field, value);
    const rounded = Number(displayValue.toFixed(2));
    const suffix = field.key === "sleep" ? " hr" : ` ${unitLabel(field)}`;

    return `${rounded}${suffix}`;
  }

  function renderHistory() {
    const list = $("#measurement-history");
    list.replaceChildren();

    if (records.length === 0) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "No entries saved yet.";
      list.append(empty);

      return;
    }

    records.forEach(record => {
      const item = document.createElement("li");
      const entry = document.createElement("div");
      entry.className = "measurement-history-entry";
      const details = document.createElement("div");
      const date = document.createElement("strong");
      date.textContent = record.date;
      details.append(date);
      const values = document.createElement("div");
      values.className = "measurement-history-values";

      FIELD_DEFINITIONS.forEach(field => {
        const value = record.values[field.key];

        if (value !== undefined) {
          const span = document.createElement("span");
          span.textContent = `${field.label}: ${formatValue(field, value)}`;
          values.append(span);
        }
      });

      details.append(values);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn ghost small";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => populateForm(record));
      entry.append(details, edit);
      item.append(entry);
      list.append(item);
    });
  }

  function showStatus(message, isError = false) {
    SUBMISSION_STATUS.set($("#measurement-status"), message, isError ? "error" : "ok");
  }

  function readRecords(key) {
    const saved = localStorage.getItem(key);
    const loadedRecords = saved === null ? [] : JSON.parse(saved);

    if (!Array.isArray(loadedRecords) || loadedRecords.some(record =>
      !record || typeof record.date !== "string" || !record.values || typeof record.values !== "object" ||
      Array.isArray(record.values) ||
      FIELD_DEFINITIONS.some(field => record.values[field.key] !== undefined &&
        (field.kind === "number" ? !Number.isFinite(record.values[field.key]) || record.values[field.key] < 0 :
          !field.options.includes(record.values[field.key]))) ||
      (record.pendingSubmissions !== undefined && (!Array.isArray(record.pendingSubmissions) ||
        record.pendingSubmissions.some(row => !row || typeof row.measurementId !== "string" ||
          typeof row.email !== "string" || typeof row.date !== "string")))
    )) {
      throw new Error("Saved measurement data has an invalid format.");
    }

    return loadedRecords;
  }

  function loadRecords() {
    try {
      records = readRecords(storageKey);
      records.sort((left, right) => right.date.localeCompare(left.date));
      renderHistory();
      updateQueue();

      return true;
    } catch (error) {
      console.error("Could not load measurement history.", error);
      showStatus("Measurement history could not be loaded from this device.", true);

      return false;
    }
  }

  function updateQueue() {
    const count = records.reduce((total, record) => total + (record.pendingSubmissions || []).length, 0);
    $("#measurement-queue").hidden = count === 0;
    $("#measurement-queue-text").textContent = `${count} measurement submission${count === 1 ? "" : "s"} waiting to be sent.`;
    $("#retry-measurements").disabled = ACTIVE_SUBMISSIONS.has(storageKey) || !hasFormConfiguration();
    $("#submit-measurements").disabled = !storageKey || !hasFormConfiguration() ||
      $("#measurement-form").dataset.storageUnavailable === "true" || ACTIVE_SUBMISSIONS.has(storageKey);
  }

  async function flushQueue() {
    const ownerKey = storageKey;
    const ownerEmail = window.WorkoutAuth.user?.email;

    if (!ownerKey || !ownerEmail || !hasFormConfiguration() || ACTIVE_SUBMISSIONS.has(ownerKey)) {
      return false;
    }

    ACTIVE_SUBMISSIONS.add(ownerKey);
    updateQueue();

    try {
      while (storageKey === ownerKey && window.WorkoutAuth.user?.email === ownerEmail) {
        const savedRecords = readRecords(ownerKey);
        const pending = savedRecords.find(record => record.pendingSubmissions?.length)?.pendingSubmissions[0];

        if (!pending) {
          return true;
        }

        if (pending.email.toLowerCase() !== ownerEmail.toLowerCase()) {
          throw new Error("The queued measurement belongs to a different account.");
        }

        await window.WorkoutForms.postRow(FORM_CONFIGURATION, pending);
        // Re-read after the request so newer entries are not overwritten.
        const latestRecords = readRecords(ownerKey);
        latestRecords.forEach(record => {
          if (record.pendingSubmissions) {
            record.pendingSubmissions = record.pendingSubmissions.filter(row => row.measurementId !== pending.measurementId);
          }
        });
        localStorage.setItem(ownerKey, JSON.stringify(latestRecords));

        if (storageKey === ownerKey) {
          records = latestRecords.sort((left, right) => right.date.localeCompare(left.date));
          updateQueue();
        }
      }

      return false;
    } catch (error) {
      console.error("Could not send queued measurements.", error);

      if (storageKey === ownerKey) {
        showStatus(`${SUBMISSION_STATUS.retryQueued("measurement")} ${error.message}`, true);
      }

      return false;
    } finally {
      ACTIVE_SUBMISSIONS.delete(ownerKey);

      if (storageKey === ownerKey) {
        updateQueue();
      }
    }
  }

  async function retryQueue() {
    if (!storageKey || !hasFormConfiguration() || ACTIVE_SUBMISSIONS.has(storageKey) ||
      !records.some(record => record.pendingSubmissions?.length)) {
      return;
    }

    const ownerKey = storageKey;
    showStatus(SUBMISSION_STATUS.retrying("measurement"));
    const sent = await flushQueue();

    if (sent && storageKey === ownerKey) {
      showStatus(SUBMISSION_STATUS.retrySent("measurement"));
    }
  }

  function showTracker() {
    $("#login-view").hidden = true;
    $("#measurements-view").hidden = false;
    storageKey = STORAGE_PREFIX + encodeURIComponent(window.WorkoutAuth.user.email.toLowerCase());
    records = [];
    $("#measurement-history").replaceChildren();
    clearFields();
    $("#measurement-form").dataset.storageUnavailable = String(!loadRecords());
    updateQueue();

    if ($("#measurement-form").dataset.storageUnavailable !== "true") {
      retryQueue();
    }
  }

  function hideTracker() {
    $("#measurements-view").hidden = true;
    $("#login-view").hidden = false;
    records = [];
    storageKey = "";
    clearFields();
    $("#measurement-history").replaceChildren();
    updateQueue();
  }

  function clearFields() {
    discardClearedFields();
    FIELD_DEFINITIONS.forEach(field => {
      $(`#measurement-${field.key}`).value = "";
    });
    $("#measurement-date").value = localDate();
    $("#measurement-status").textContent = "";
    $("#measurement-status").className = "status";
  }

  function discardClearedFields() {
    clearedFields = null;
    $("#undo-clear-measurements").hidden = true;
  }

  function clearFieldsWithUndo() {
    const snapshot = {
      date: $("#measurement-date").value,
      units: currentUnits(),
      values: Object.fromEntries(FIELD_DEFINITIONS.map(field =>
        [field.key, $(`#measurement-${field.key}`).value]))
    };
    clearFields();
    clearedFields = snapshot;
    showStatus("Fields cleared.");
    $("#undo-clear-measurements").hidden = false;
    $("#undo-clear-measurements").focus();
  }

  function undoClearFields() {
    if (!clearedFields) {
      return;
    }

    $("#measurement-date").value = clearedFields.date;
    FIELD_DEFINITIONS.forEach(field => {
      const value = clearedFields.values[field.key];
      const convertUnits = value !== "" && field.kind === "number" && clearedFields.units !== currentUnits();
      $(`#measurement-${field.key}`).value = convertUnits ?
        String(Number(fromCanonical(field, toCanonical(field, Number(value), clearedFields.units)).toFixed(2))) : value;
    });
    discardClearedFields();
    showStatus("Fields restored.");
    $("#clear-measurements").focus();
  }

  async function saveEntry(event) {
    event.preventDefault();
    discardClearedFields();

    if (!storageKey || !window.WorkoutAuth.user) {
      showStatus("Sign in before submitting measurements.", true);

      return;
    }

    if (!hasFormConfiguration()) {
      showStatus("Configure the measurements Google Form before submitting.", true);

      return;
    }

    if (ACTIVE_SUBMISSIONS.has(storageKey)) {
      showStatus("Please wait for the current submission to finish.", true);

      return;
    }

    if ($("#measurement-form").dataset.storageUnavailable === "true") {
      showStatus("This entry was not saved because measurement history could not be loaded.", true);

      return;
    }

    const values = collectValues();
    const date = $("#measurement-date").value;

    if (!$("#measurement-form").reportValidity() || !date ||
      FIELD_DEFINITIONS.some(field => values[field.key] !== undefined &&
        (field.kind === "number" ? !Number.isFinite(values[field.key]) || values[field.key] < 0 :
          !field.options.includes(values[field.key])))) {
      showStatus("Choose a date and enter valid, non-negative measurements and supported states.", true);

      return;
    }

    if (Object.keys(values).length === 0) {
      showStatus("Enter at least one measurement or state before saving.", true);

      return;
    }

    const row = {
      email: window.WorkoutAuth.user.email,
      measurementId: crypto.randomUUID(),
      date
    };
    FIELD_DEFINITIONS.forEach((field, index) => {
      if (values[field.key] !== undefined) {
        row[FORM_FIELD_NAMES[index]] = values[field.key];
      }
    });

    try {
      const latestRecords = readRecords(storageKey);
      const existingIndex = latestRecords.findIndex(record => record.date === date);
      const pendingSubmissions = existingIndex === -1 ? [] : (latestRecords[existingIndex].pendingSubmissions || []);
      const record = { date, values, pendingSubmissions: [...pendingSubmissions, row] };

      if (existingIndex === -1) {
        latestRecords.push(record);
      } else {
        latestRecords[existingIndex] = record;
      }

      latestRecords.sort((left, right) => right.date.localeCompare(left.date));
      // Persist history and its pending submission together before making a network request.
      localStorage.setItem(storageKey, JSON.stringify(latestRecords));
      records = latestRecords;
    } catch (error) {
      console.error("Could not queue measurements.", error);
      showStatus("Measurements could not be saved on this device. Nothing was sent. Check browser storage.", true);

      return;
    }

    renderHistory();
    updateQueue();
    const ownerKey = storageKey;
    showStatus(SUBMISSION_STATUS.submitting("measurement"));
    const sent = await flushQueue();

    if (storageKey !== ownerKey) {
      return;
    }

    showStatus(sent ? SUBMISSION_STATUS.sent("measurement") : SUBMISSION_STATUS.queued("measurement"), !sent);
  }

  function changeUnits(event) {
    const values = collectValues(event.detail.previousUnits);
    renderFields();
    FIELD_DEFINITIONS.forEach(field => {
      const value = values[field.key];

      if (value !== undefined) {
        const input = $(`#measurement-${field.key}`);
        input.value = field.kind === "number" ? String(Number(fromCanonical(field, value).toFixed(2))) : value;
      }
    });
    renderHistory();
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderFields();
    $("#measurement-date").value = localDate();
    $("#measurement-form").addEventListener("submit", saveEntry);
    $("#measurement-form").addEventListener("input", discardClearedFields);
    $("#measurement-form").addEventListener("change", discardClearedFields);
    $("#clear-measurements").addEventListener("click", clearFieldsWithUndo);
    $("#undo-clear-measurements").addEventListener("click", undoClearFields);
    $("#retry-measurements").addEventListener("click", retryQueue);
    window.addEventListener("online", retryQueue);
    document.addEventListener("workout:unitschange", changeUnits);
    $("#setup-warning").hidden = hasFormConfiguration();
    window.WorkoutAuth.init({ onSignIn: showTracker, onSignOut: hideTracker });
  });
})();
