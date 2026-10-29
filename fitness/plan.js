(() => {
  "use strict";

  const PLAN_STORAGE_KEY = "plan.cycle";
  const DAYS_PER_WEEK = 7;
  const MILLISECONDS_PER_DAY = 86400000;
  const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const selectElement = selector => document.querySelector(selector);
  let currentCalendarOffset = 0;
  let allRoutines = [];
  let planData = emptyPlan();
  let planNameCaptureRequested = false;
  let detailsApplied = false;
  let storageAvailable = true;
  let routinesLoading = false;
  let accountVersion = 0;
  let savedPlans = new Map();
  let plansBusy = false;

  function emptyPlan() {
    return { name: "", duration: 4, unit: "weeks", startDate: defaultStartDate("weeks"), routines: {} };
  }

  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const date = new Date(`${value}T00:00:00Z`);

    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  }

  function addDays(date, days) {
    return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
  }

  function defaultStartDate(unit) {
    const today = new Date();
    const date = parseDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`);
    const daysUntilMonday = (8 - date.getUTCDay()) % DAYS_PER_WEEK || DAYS_PER_WEEK;
    const startDate = unit === "weeks" ? addDays(date, daysUntilMonday) : date;

    return startDate.toISOString().slice(0, 10);
  }

  function cycleStart(plan = planData) {
    return parseDate(plan.startDate || defaultStartDate(plan.unit));
  }

  function cycleEnd(plan = planData) {
    return addDays(cycleStart(plan), cycleDays(plan) - 1);
  }

  function formatDate(date, options = {}) {
    return date.toLocaleDateString(undefined, { timeZone: "UTC", ...options });
  }

  function monthStart(date, offset = 0) {
    const firstDate = new Date(date);
    firstDate.setUTCDate(1);
    firstDate.setUTCMonth(firstDate.getUTCMonth() + offset);

    return firstDate;
  }

  function lastCalendarOffset() {
    if (planData.unit === "weeks") {
      return planData.duration - 1;
    }

    const firstDate = cycleStart();
    const lastDate = cycleEnd();

    return (lastDate.getUTCFullYear() - firstDate.getUTCFullYear()) * 12 +
      lastDate.getUTCMonth() - firstDate.getUTCMonth();
  }

  function updateStartDateRules() {
    const weekly = selectElement("#cycle-unit").value === "weeks";
    const startInput = selectElement("#plan-start-date");
    startInput.step = weekly ? "7" : "1";
    startInput.setCustomValidity("");

    if (weekly && parseDate(startInput.value)?.getUTCDay() !== 1) {
      startInput.setCustomValidity("Choose a Monday as the start date for a week-based cycle.");
    }

    selectElement("#plan-start-help").textContent = weekly ?
      "Week cycles must start on a Monday. Only Monday dates are valid." :
      "Day cycles can start on any date. The calendar shows the full month containing the start date.";
  }

  function cycleDays(plan = planData) {
    return plan.duration * (plan.unit === "weeks" ? DAYS_PER_WEEK : 1);
  }

  function showStatus(message, isError = false) {
    const statusElement = selectElement("#plan-status");
    statusElement.textContent = message;
    statusElement.classList.toggle("error", isError);
  }

  function showCloudStatus(message, isError = false) {
    const status = selectElement("#plan-cloud-status");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function updatePlanActions() {
    const unavailable = plansBusy || !WorkoutPlans.isConfigured();
    selectElement("#refresh-plans").disabled = unavailable;
    selectElement("#save-plan").disabled = unavailable;
    selectElement("#plan-name-select").disabled = unavailable || savedPlans.size === 0;
    selectElement("#choose-saved-plan").disabled = unavailable || savedPlans.size === 0;
  }

  function updatePlanNameControl() {
    const nameInput = selectElement("#plan-name");
    const planSelect = selectElement("#plan-name-select");
    const currentName = nameInput.value.trim();
    const matchingPlan = [...savedPlans].find(([, plan]) =>
      plan.name.toLowerCase() === currentName.toLowerCase());

    const placeholder = new Option(savedPlans.size ? "Choose a saved plan..." : "No saved plans found", "");
    placeholder.disabled = true;
    planSelect.replaceChildren(placeholder);

    for (const [planId, plan] of [...savedPlans].sort(([, firstPlan], [, secondPlan]) =>
      firstPlan.name.localeCompare(secondPlan.name))) {
      planSelect.append(new Option(`${plan.name} (${plan.duration} ${plan.unit}, ${plan.startDate})`, planId));
    }

    const captureOption = new Option("Capture new", "__capture_new__");
    captureOption.dataset.captureNew = "true";
    planSelect.append(captureOption);
    planSelect.value = matchingPlan ? matchingPlan[0] : "";

    const captureActive = planNameCaptureRequested || !savedPlans.size || Boolean(currentName && !matchingPlan);
    planSelect.hidden = captureActive;
    selectElement("#plan-name-capture").hidden = !captureActive;
    selectElement("#choose-saved-plan").hidden = !captureActive || !savedPlans.size;
    selectElement("#plan-name-label").htmlFor = captureActive ? "plan-name" : "plan-name-select";
    nameInput.required = captureActive;
    planSelect.required = !captureActive;
    updatePlanActions();
  }

  function populateSavedPlans(catalog) {
    savedPlans = catalog.plans;
    updatePlanNameControl();
  }

  async function refreshSavedPlans() {
    if (plansBusy) {
      return;
    }

    const requestVersion = accountVersion;
    plansBusy = true;
    updatePlanActions();
    showCloudStatus("Loading your saved plans...");

    try {
      const catalog = await WorkoutPlans.load();

      if (requestVersion !== accountVersion) {
        return;
      }

      populateSavedPlans(catalog);
      showCloudStatus(catalog.warnings.length ? catalog.warnings.join(" ") :
        `Loaded ${savedPlans.size} saved plan(s).`, catalog.warnings.length > 0);
    } catch (error) {
      if (requestVersion === accountVersion) {
        console.error("Could not load saved plans.", error);
        showCloudStatus(`Could not load saved plans: ${error.message} Choose Refresh saved plans to retry.`, true);
      }
    } finally {
      if (requestVersion === accountVersion) {
        plansBusy = false;
        updatePlanActions();
      }
    }
  }

  async function savePlanSnapshot() {
    if (plansBusy) {
      return;
    }

    if (!detailsApplied || !storageAvailable) {
      showCloudStatus("Apply the current plan details before saving a snapshot.", true);

      return;
    }

    if ([...selectElement("#calendar-grid").querySelectorAll(".day-routine-form")]
      .some(form => !form.hidden)) {
      showCloudStatus("Confirm or cancel open routine pickers before saving a snapshot.", true);

      return;
    }

    const requestVersion = accountVersion;
    plansBusy = true;
    updatePlanActions();
    showCloudStatus("Saving plan snapshot and checking every routine row in Google Forms...");

    try {
      const catalog = await WorkoutPlans.save(planData);

      if (requestVersion !== accountVersion) {
        return;
      }

      populateSavedPlans(catalog);
      showCloudStatus("Plan snapshot saved. Every routine row was confirmed in Google Forms.");
    } catch (error) {
      if (requestVersion === accountVersion) {
        console.error("Could not save plan snapshot.", error);
        showCloudStatus(`Could not save plan snapshot: ${error.message}`, true);
      }
    } finally {
      if (requestVersion === accountVersion) {
        plansBusy = false;
        updatePlanActions();
      }
    }
  }

  function loadSelectedPlan() {
    const selected = savedPlans.get(selectElement("#plan-name-select").value);

    if (plansBusy || !selected) {
      showCloudStatus("Choose a saved plan to load.", true);
      updatePlanNameControl();

      return;
    }

    if ((planData.name || selectElement("#plan-name").value) &&
        !confirm("Replace the current local plan and unsaved selections with this saved snapshot?")) {
      updatePlanNameControl();

      return;
    }

    if (!savePlan(selected)) {
      showCloudStatus("Could not replace the local draft. See the plan details status.", true);
      updatePlanNameControl();

      return;
    }

    detailsApplied = true;
    currentCalendarOffset = 0;
    selectElement("#calendar-grid").replaceChildren();
    fillPlanDetails();
    renderCalendar();
    showCloudStatus(`Loaded "${planData.name}" from Google Forms into the local draft.`);
  }

  function fillPlanDetails() {
    selectElement("#plan-name").value = planData.name;
    selectElement("#cycle-duration").value = planData.duration;
    selectElement("#cycle-unit").value = planData.unit;
    selectElement("#plan-start-date").value = planData.startDate || defaultStartDate(planData.unit);
    updateStartDateRules();
    updatePlanNameControl();
  }

  function validatePlan(plan) {
    if (!plan || typeof plan.name !== "string" || !plan.name.trim() ||
        !["days", "weeks"].includes(plan.unit) || !Number.isSafeInteger(plan.duration) ||
        plan.duration < 1 || !Number.isSafeInteger(cycleDays(plan)) ||
        !plan.routines || typeof plan.routines !== "object" || Array.isArray(plan.routines)) {
      throw new Error("The saved cycle plan has invalid details.");
    }

    if (plan.startDate !== undefined && (!parseDate(plan.startDate) ||
        (plan.unit === "weeks" && parseDate(plan.startDate).getUTCDay() !== 1))) {
      throw new Error("Choose a valid start date; week-based cycles must start on a Monday.");
    }

    if (!Number.isFinite(cycleEnd(plan).getTime()) ||
        cycleEnd(plan).getUTCFullYear() > 9999) {
      throw new Error("The cycle must end on or before 31 December 9999.");
    }

    for (const [day, routines] of Object.entries(plan.routines)) {
      const dayNumber = Number(day);

      if (!Number.isSafeInteger(dayNumber) || String(dayNumber) !== day ||
          dayNumber < 1 || dayNumber > cycleDays(plan) || !Array.isArray(routines) ||
          routines.some(name => typeof name !== "string" || !name.trim()) ||
          new Set(routines).size !== routines.length) {
        throw new Error("The saved cycle plan has invalid routine entries.");
      }
    }
  }

  function savePlan(nextPlan) {
    try {
      if (!storageAvailable || !WorkoutAuth.user) {
        throw new Error("Plan storage is unavailable. Sign in or reload the page before trying again.");
      }

      validatePlan(nextPlan);
      localStorage.setItem(`${PLAN_STORAGE_KEY}:${WorkoutAuth.user.email}`, JSON.stringify(nextPlan));
      planData = nextPlan;

      return true;
    } catch (error) {
      console.error("Could not save the cycle plan.", error);
      showStatus(`Could not save the cycle plan: ${error.message}`, true);

      return false;
    }
  }

  function updateCaptureAvailability() {
    const captureDisabled =
      !detailsApplied || !storageAvailable || routinesLoading || allRoutines.length === 0;
    selectElement("#add-routine-btn").disabled = captureDisabled;
    document.querySelectorAll(".day-confirm, .day-routine-select").forEach(control => {
      control.disabled = captureDisabled;
    });
  }

  function renderCalendar(savedDay = null) {
    const totalDays = cycleDays();
    const startDate = cycleStart();
    const monthly = planData.unit === "days";
    const firstDate = monthly ? monthStart(startDate, currentCalendarOffset) :
      addDays(startDate, currentCalendarOffset * DAYS_PER_WEEK);
    const lastDate = monthly ? addDays(monthStart(firstDate, 1), -1) :
      addDays(firstDate, DAYS_PER_WEEK - 1);
    const calendarGrid = selectElement("#calendar-grid");
    const pendingSelections = [...calendarGrid.querySelectorAll(".day-card[data-cycle-day]")]
      .filter(day => Number(day.dataset.cycleDay) !== savedDay &&
        !day.querySelector(".day-routine-form").hidden)
      .map(day => ({
        date: day.dataset.date,
        selection: day.querySelector(".day-routine-select").value,
        options: [...day.querySelector(".day-routine-select").options].map(option => ({
          text: option.textContent, value: option.value
        })),
        message: day.querySelector(".day-capture-status").textContent
      }));
    const daySelect = selectElement("#day-select");
    const previousDay = daySelect.value;
    calendarGrid.replaceChildren();
    daySelect.replaceChildren();
    selectElement("#week-range-text").textContent = monthly ?
      `${planData.name || "New plan"}: ${formatDate(firstDate, { month: "long", year: "numeric" })}` :
      `${planData.name || "New plan"}: Week ${currentCalendarOffset + 1} - ${formatDate(firstDate)} - ${formatDate(lastDate)}`;
    selectElement("#prev-week").disabled = currentCalendarOffset === 0;
    selectElement("#next-week").disabled = currentCalendarOffset === lastCalendarOffset();
    selectElement("#prev-week").setAttribute("aria-label", monthly ? "Previous month" : "Previous week");
    selectElement("#next-week").setAttribute("aria-label", monthly ? "Next month" : "Next week");
    selectElement("#cycle-week-field").hidden = monthly;
    selectElement("#cycle-week").disabled = monthly;
    selectElement("#cycle-week").max = Math.ceil(totalDays / DAYS_PER_WEEK);
    selectElement("#cycle-week").value = currentCalendarOffset + 1;

    for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
      const dayNumber = Math.round((date - startDate) / MILLISECONDS_PER_DAY) + 1;

      if (dayNumber >= 1 && dayNumber <= totalDays) {
        const option = document.createElement("option");
        option.value = dayNumber;
        option.textContent = `Day ${dayNumber} - ${formatDate(date)}`;
        daySelect.append(option);
      }
    }

    renderCalendarDates(calendarGrid);

    for (const pending of pendingSelections) {
      const day = calendarGrid.querySelector(`[data-date="${pending.date}"][data-cycle-day]`);

      if (!day) {
        continue;
      }

      const routineSelect = day.querySelector(".day-routine-select");
      routineSelect.replaceChildren(...pending.options.map(option => new Option(option.text, option.value)));
      routineSelect.value = pending.selection;
      day.querySelector(".day-capture-status").textContent = pending.message;
      day.querySelector(".day-add").hidden = true;
      day.querySelector(".day-routine-form").hidden = false;
    }

    if ([...daySelect.options].some(option => option.value === previousDay)) {
      daySelect.value = previousDay;
    }

    updateCaptureAvailability();
  }

  function renderCalendarDates(calendarGrid) {
    const startDate = cycleStart();
    const firstDate = monthStart(startDate);
    const lastDate = addDays(monthStart(cycleEnd(), 1), -1);
    const today = defaultStartDate("days");

    for (const weekday of WEEKDAY_NAMES) {
      const heading = document.createElement("div");
      heading.className = "calendar-weekday";
      heading.textContent = weekday;
      calendarGrid.append(heading);
    }

    const leadingDays = (firstDate.getUTCDay() + 6) % DAYS_PER_WEEK;

    for (let blankIndex = 0; blankIndex < leadingDays; blankIndex += 1) {
      const blank = document.createElement("div");
      blank.className = "calendar-blank";
      blank.setAttribute("aria-hidden", "true");
      calendarGrid.append(blank);
    }

    for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
      const dayNumber = Math.round((date - startDate) / MILLISECONDS_PER_DAY) + 1;
      const withinCycle = dayNumber >= 1 && dayNumber <= cycleDays();
      const scheduledDay = dayNumber >= 1 ? ((dayNumber - 1) % cycleDays()) + 1 : null;

      const dayCard = selectElement("#day-card-template").content.cloneNode(true);
      const dayElement = dayCard.querySelector(".day-card");
      dayElement.dataset.date = date.toISOString().slice(0, 10);
      dayElement.classList.toggle("outside-cycle", !withinCycle);
      dayElement.classList.toggle("calendar-weekend", date.getUTCDay() === 0 || date.getUTCDay() === 6);
      const isToday = dayElement.dataset.date === today;
      dayElement.classList.toggle("calendar-today", isToday);
      dayElement.setAttribute("aria-label", formatDate(date, {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
      }));

      if (isToday) {
        dayElement.setAttribute("aria-current", "date");
      }

      if (withinCycle) {
        dayElement.dataset.cycleDay = dayNumber;
      }

      const dateHeading = dayCard.querySelector(".day-name");
      const dateNumber = document.createElement("span");
      dateNumber.className = "calendar-date-number";
      dateNumber.textContent = date.getUTCDate();
      dateHeading.append(dateNumber);

      if (date.getTime() === firstDate.getTime() || date.getUTCDate() === 1) {
        const monthLabel = document.createElement("span");
        monthLabel.className = "calendar-month-label";
        monthLabel.textContent = formatDate(date, { month: "short", year: "numeric" });
        dateHeading.append(monthLabel);
      }
      dayCard.querySelector(".day-date").textContent = withinCycle ? `Day ${dayNumber}` : "Outside cycle";

      if (!withinCycle && scheduledDay !== null) {
        dayCard.querySelector(".day-date").textContent = `Outside cycle - Day ${scheduledDay} (preview)`;
      }

      for (const routineName of scheduledDay !== null ? planData.routines[scheduledDay] || [] : []) {
        const routineEntry = selectElement("#routine-entry-template").content.cloneNode(true);
        routineEntry.querySelector(".routine-entry-name").textContent = routineName;
        const removeButton = routineEntry.querySelector(".remove-routine");

        if (withinCycle) {
          removeButton.setAttribute("aria-label", `Remove ${routineName} from Day ${dayNumber}`);
          removeButton.addEventListener("click", () => removeRoutine(dayNumber, routineName));
        } else {
          removeButton.remove();
        }

        dayCard.querySelector(".day-routines").append(routineEntry);
      }

      if (withinCycle) {
        setupDayCapture(dayElement, dayNumber, date);
      } else {
        dayElement.querySelector(".day-capture").remove();
      }

      calendarGrid.append(dayCard);
    }

    function setupDayCapture(dayElement, dayNumber, date) {
      const addButton = dayElement.querySelector(".day-add");
      const captureForm = dayElement.querySelector(".day-routine-form");
      const routineSelect = captureForm.querySelector(".day-routine-select");
      const confirmButton = captureForm.querySelector(".day-confirm");
      const dateLabel = formatDate(date, { day: "numeric", month: "long", year: "numeric" });
      addButton.setAttribute("aria-label", `Add routine on ${dateLabel}`);
      routineSelect.setAttribute("aria-label", `Routine for ${dateLabel}`);
      confirmButton.setAttribute("aria-label", `Confirm routine on ${dateLabel}`);
      addButton.addEventListener("click", async () => {
        if (!storageAvailable) {
          showStatus("Plan storage is unavailable. Reload the page before adding routines.", true);
          selectElement("#plan-status").scrollIntoView({ block: "center" });

          return;
        }

        if (!detailsApplied) {
          showStatus("Enter a plan name and choose Apply plan details before adding routines.", true);
          selectElement("#plan-details").scrollIntoView({ block: "center" });

          if (selectElement("#plan-details").reportValidity()) {
            selectElement("#plan-details button[type=\"submit\"]").focus();
          }

          return;
        }

        if (routinesLoading) {
          showStatus("Routines are loading. Try Add again when loading finishes.");

          return;
        }

        if (allRoutines.length === 0) {
          const requestVersion = accountVersion;
          await loadRoutines();

          if (requestVersion !== accountVersion || !dayElement.isConnected ||
              !detailsApplied || allRoutines.length === 0) {
            selectElement("#plan-status").scrollIntoView({ block: "center" });

            return;
          }
        }

        routineSelect.replaceChildren(new Option("Choose routine...", ""));

        for (const routine of allRoutines) {
          routineSelect.append(new Option(routine.name, routine.name));
        }

        addButton.hidden = true;
        captureForm.hidden = false;
        updateCaptureAvailability();
        routineSelect.focus();
      });
      captureForm.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          event.preventDefault();
          captureForm.hidden = true;
          addButton.hidden = false;
          captureForm.querySelector(".day-capture-status").textContent = "";
          addButton.focus();
        }
      });
      captureForm.addEventListener("submit", event => {
        event.preventDefault();

        if (addRoutineToDay(dayNumber, routineSelect.value)) {
          selectElement(`[data-cycle-day="${dayNumber}"] .day-add`).focus();
        } else {
          captureForm.querySelector(".day-capture-status").textContent = selectElement("#plan-status").textContent;
        }
      });
    }

    const trailingDays = DAYS_PER_WEEK - 1 - ((lastDate.getUTCDay() + 6) % DAYS_PER_WEEK);

    for (let blankIndex = 0; blankIndex < trailingDays; blankIndex += 1) {
      const blank = document.createElement("div");
      blank.className = "calendar-blank";
      blank.setAttribute("aria-hidden", "true");
      calendarGrid.append(blank);
    }

  }

  function applyPlanDetails(event) {
    event.preventDefault();
    const nameInput = selectElement("#plan-name");
    const durationInput = selectElement("#cycle-duration");
    const nextPlan = {
      ...planData,
      name: nameInput.value.trim(),
      duration: durationInput.valueAsNumber,
      unit: selectElement("#cycle-unit").value,
      startDate: selectElement("#plan-start-date").value
    };

    if (!nextPlan.name || !Number.isSafeInteger(nextPlan.duration) ||
        nextPlan.duration < 1 || !Number.isSafeInteger(cycleDays(nextPlan))) {
      showStatus("Enter a plan name and a positive whole-number cycle duration.", true);

      return;
    }

    if (!parseDate(nextPlan.startDate) ||
        (nextPlan.unit === "weeks" && parseDate(nextPlan.startDate).getUTCDay() !== 1)) {
      showStatus("Choose a valid start date. Week-based cycles must start on a Monday.", true);

      return;
    }

    if (Object.keys(planData.routines).some(day => Number(day) > cycleDays(nextPlan))) {
      showStatus("Remove routines beyond the new cycle duration before shortening it. No entries were changed.", true);

      return;
    }

    if (!savePlan(nextPlan)) {
      return;
    }

    detailsApplied = true;
    nameInput.value = planData.name;
    currentCalendarOffset = 0;
    renderCalendar();
    showStatus(`Saved "${planData.name}": ${planData.duration} ${planData.unit} (${cycleDays()} days).`);
  }

  function captureRoutine(event) {
    event.preventDefault();
    const routineName = selectElement("#routine-select").value;
    const dayNumber = Number(selectElement("#day-select").value);

    addRoutineToDay(dayNumber, routineName);
  }

  function addRoutineToDay(dayNumber, routineName) {
    if (!detailsApplied || !allRoutines.some(routine => routine.name === routineName) ||
        !Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > cycleDays()) {
      showStatus("Apply the plan details, then choose a saved routine and a day within the cycle.", true);

      return false;
    }

    const routinesForDay = planData.routines[dayNumber] || [];

    if (routinesForDay.includes(routineName)) {
      showStatus(`${routineName} is already scheduled for Day ${dayNumber}.`, true);

      return false;
    }

    const routines = { ...planData.routines, [dayNumber]: [...routinesForDay, routineName] };

    if (savePlan({ ...planData, routines })) {
      renderCalendar(dayNumber);
      showStatus(`Added ${routineName} to "${planData.name}", Day ${dayNumber}.`);

      return true;
    }

    return false;
  }

  function removeRoutine(dayNumber, routineName) {
    const routines = { ...planData.routines };
    routines[dayNumber] = routines[dayNumber].filter(name => name !== routineName);

    if (routines[dayNumber].length === 0) {
      delete routines[dayNumber];
    }

    if (savePlan({ ...planData, routines })) {
      renderCalendar();
      showStatus(`Removed ${routineName} from Day ${dayNumber}.`);
    }
  }

  async function loadRoutines() {
    const requestVersion = accountVersion;

    if (routinesLoading) {
      return;
    }

    routinesLoading = true;
    updateRoutineDropdowns("Routines loading...");
    selectElement("#refresh-routines").disabled = true;
    updateCaptureAvailability();

    try {
      const catalog = await WorkoutRoutines.load();

      if (requestVersion !== accountVersion) {
        return;
      }

      allRoutines = [...catalog.routines.values()];
      updateRoutineDropdowns(allRoutines.length ? "Choose routine..." : "No routines available");

      showStatus(catalog.warnings.length ? catalog.warnings.join(" ") :
        allRoutines.length ? "Routines loaded." : "No saved routines found. Save a routine on the Log page first.",
      catalog.warnings.length > 0);
    } catch (error) {
      if (requestVersion === accountVersion) {
        updateRoutineDropdowns(allRoutines.length ? "Choose routine..." : "Could not load routines - retry");
        console.error("Could not load routines.", error);
        showStatus(`Could not load routines: ${error.message} Use Refresh routines to retry.`, true);
      }
    } finally {
      if (requestVersion === accountVersion) {
        routinesLoading = false;
        selectElement("#routine-select").disabled = allRoutines.length === 0;
        selectElement("#refresh-routines").disabled = false;
        updateCaptureAvailability();
      }
    }
  }

  function updateRoutineDropdowns(placeholder) {
    document.querySelectorAll("#routine-select, .day-routine-select").forEach(routineSelect => {
      const previousSelection = routineSelect.value;
      routineSelect.replaceChildren(new Option(placeholder, ""));

      for (const routine of allRoutines) {
        routineSelect.append(new Option(routine.name, routine.name));
      }

      if (allRoutines.some(routine => routine.name === previousSelection)) {
        routineSelect.value = previousSelection;
      }

      routineSelect.disabled = true;
    });
  }

  function showPlanAfterSignIn() {
    accountVersion += 1;
    planData = emptyPlan();
    detailsApplied = false;
    storageAvailable = true;
    routinesLoading = false;
    allRoutines = [];
    savedPlans = new Map();
    plansBusy = false;
    planNameCaptureRequested = false;
    updatePlanNameControl();
    showCloudStatus("");
    updatePlanActions();
    currentCalendarOffset = 0;
    selectElement("#calendar-grid").replaceChildren();
    selectElement("#routine-select").replaceChildren(new Option("Choose routine...", ""));
    selectElement("#plan-view").hidden = false;
    showStatus("");

    try {
      const stored = localStorage.getItem(`${PLAN_STORAGE_KEY}:${WorkoutAuth.user.email}`);

      if (stored) {
        const { entries, ...savedPlan } = JSON.parse(stored);
        const restoredPlan = {
          ...savedPlan,
          routines: Object.hasOwn(savedPlan, "routines") ? savedPlan.routines : entries
        };
        validatePlan(restoredPlan);
        planData = restoredPlan;
        detailsApplied = Boolean(restoredPlan.startDate);
      }
    } catch (error) {
      storageAvailable = false;
      console.error("Could not load the cycle plan.", error);
      showStatus(`Could not load the cycle plan: ${error.message} Stored data has not been changed.`, true);
    }

    fillPlanDetails();
    renderCalendar();

    if (storageAvailable) {
      loadRoutines();
    }

    if (WorkoutPlans.isConfigured()) {
      refreshSavedPlans();
    } else {
      showCloudStatus("Set up the plan form to save and load snapshots. Local planning remains available.");
    }
  }

  selectElement("#setup-warning").hidden = WorkoutPlans.isConfigured();
  selectElement("#refresh-plans").addEventListener("click", refreshSavedPlans);
  selectElement("#plan-name-select").addEventListener("change", event => {
    const captureNew = event.target.selectedOptions[0].dataset.captureNew === "true";
    planNameCaptureRequested = captureNew;

    if (captureNew) {
      selectElement("#plan-name").value = "";
      updatePlanNameControl();
      selectElement("#plan-name").dispatchEvent(new Event("input", { bubbles: true }));
      selectElement("#plan-name").focus();

      return;
    }

    loadSelectedPlan();
  });
  selectElement("#clear-plan-name").addEventListener("click", () => {
    selectElement("#plan-name").value = "";
    selectElement("#plan-name").dispatchEvent(new Event("input", { bubbles: true }));
    selectElement("#plan-name").focus();
  });
  selectElement("#choose-saved-plan").addEventListener("click", () => {
    selectElement("#plan-name").value = "";
    planNameCaptureRequested = false;
    updatePlanNameControl();
    selectElement("#plan-name").dispatchEvent(new Event("input", { bubbles: true }));
    selectElement("#plan-name-select").focus();
  });
  selectElement("#save-plan").addEventListener("click", savePlanSnapshot);
  selectElement("#plan-details").addEventListener("submit", applyPlanDetails);
  selectElement("#cycle-unit").addEventListener("change", () => {
    const unit = selectElement("#cycle-unit").value;
    const startDateInput = selectElement("#plan-start-date");

    if (unit === "weeks" || !parseDate(startDateInput.value)) {
      startDateInput.value = defaultStartDate(unit);
    }

    detailsApplied = false;
    updateStartDateRules();
    updateCaptureAvailability();
  });
  selectElement("#plan-details").addEventListener("input", () => {
    detailsApplied = false;
    updateStartDateRules();
    updateCaptureAvailability();
  });
  selectElement("#routine-capture-form").addEventListener("submit", captureRoutine);
  selectElement("#refresh-routines").addEventListener("click", loadRoutines);
  selectElement("#prev-week").addEventListener("click", () => {
    currentCalendarOffset = Math.max(0, currentCalendarOffset - 1);
    renderCalendar();
  });
  selectElement("#next-week").addEventListener("click", () => {
    currentCalendarOffset = Math.min(lastCalendarOffset(), currentCalendarOffset + 1);
    renderCalendar();
  });
  selectElement("#cycle-week").addEventListener("change", () => {
    const weekInput = selectElement("#cycle-week");

    if (!weekInput.reportValidity()) {
      return;
    }

    currentCalendarOffset = weekInput.valueAsNumber - 1;
    renderCalendar();
  });
  function clearPlanEntries() {
    if (confirm("Clear all routine entries? Plan details will be kept.") &&
        savePlan({ ...planData, routines: {} })) {
      renderCalendar();
      showStatus("Routine entries cleared. Plan details kept.");
    }
  }

  selectElement("#clear-plan").addEventListener("click", clearPlanEntries);
  selectElement("#clear-plan-details").addEventListener("click", clearPlanEntries);
  selectElement("#export-plan").addEventListener("click", () => {
    if (!planData.name || !storageAvailable) {
      showStatus("Apply valid plan details before exporting.", true);

      return;
    }

    const downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(planData, null, 2)],
      { type: "application/json" }));
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = "fitness-plan.json";
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  });

  WorkoutAuth.init({
    onSignIn: showPlanAfterSignIn,
    onSignOut() {
      accountVersion += 1;
      allRoutines = [];
      planData = emptyPlan();
      savedPlans = new Map();
      plansBusy = false;
      planNameCaptureRequested = false;
      updatePlanNameControl();
      showCloudStatus("");
      updatePlanActions();
      selectElement("#calendar-grid").replaceChildren();
      selectElement("#plan-view").hidden = true;
    }
  });
})();
