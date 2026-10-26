(() => {
  "use strict";

  const CONFIG = window.WORKOUT_CONFIG || {};
  const FORM = CONFIG.form || {};
  const SCOPES = [
    "https://www.googleapis.com/auth/forms.body.readonly",
    "https://www.googleapis.com/auth/forms.responses.readonly"
  ];
  const API = "https://forms.googleapis.com/v1/forms";
  const TOKEN_KEY = "workout.trendsToken";
  const SECONDS_PER_REP = 10;
  const REST_BETWEEN_SETS = 60;

  // Question titles used by setup/create-form.gs, for forms whose question IDs don't match the entry IDs.
  const TITLES = {
    "email": "email", "session id": "sessionId", "workout date": "date", "routine": "routine",
    "exercise": "exercise", "exercise order": "exerciseOrder", "set number": "setNumber",
    "measure (reps/time)": "measure", "reps": "reps", "duration (seconds)": "durationSeconds",
    "weight (kg)": "weightKg", "perceived difficulty (rpe 1-10)": "rpe", "set notes": "notes",
    "session notes": "sessionNotes"
  };

  const $ = sel => document.querySelector(sel);

  let rows = [];
  let allRows = [];
  let loadedAt = null;
  let loading = false;

  // ---------- helpers ----------
  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "–";
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  const round1 = n => Math.round(n * 10) / 10;
  const avg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : NaN);
  const fmt = (n, digits = 1) => (Number.isFinite(n) ? String(Math.round(n * 10 ** digits) / 10 ** digits) : "–");

  function setStatus(message, kind = "") {
    const el = $("#trends-status");
    el.textContent = message;
    el.className = `status ${kind}`;
  }

  function showForkHelp(reason) {
    $("#fork-reason").textContent = reason;
    $("#fork-help").hidden = false;
    $("#results").hidden = true;
  }

  // ---------- access token ----------
  function cachedToken() {
    try {
      const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
      if (t && t.email === WorkoutAuth.user?.email && t.expiresAt > Date.now() + 60000) return t.token;
    } catch { /* ignore */ }
    return null;
  }

  async function getToken(forceNew) {
    if (!forceNew) {
      const token = cachedToken();
      if (token) return token;
    }
    const token = await WorkoutAuth.requestAccessToken(SCOPES);
    // GIS access tokens last one hour.
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, email: WorkoutAuth.user.email, expiresAt: Date.now() + 55 * 60000 }));
    return token;
  }

  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message || `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
    get reason() {
      const details = this.body?.error?.details || [];
      return details.map(d => d.reason).find(Boolean) || this.body?.error?.status || "";
    }
  }

  async function apiGet(path, token) {
    const response = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, body);
    return body;
  }

  // ---------- reading responses ----------
  function buildQuestionMap(form) {
    const byEntry = new Map();
    Object.entries(FORM.fields || {}).forEach(([key, entry]) => {
      const match = /^entry\.(\d+)$/.exec(entry || "");
      if (match) byEntry.set(Number(match[1]), key);
    });
    const map = new Map();
    (form.items || []).forEach(item => {
      const qid = item.questionItem?.question?.questionId;
      if (!qid) return;
      const key = byEntry.get(parseInt(qid, 16)) || TITLES[(item.title || "").trim().toLowerCase()];
      if (key) map.set(qid, key);
    });
    return map;
  }

  async function fetchAllResponses(token) {
    const all = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ pageSize: "5000" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await apiGet(`${encodeURIComponent(FORM.formId)}/responses?${query}`, token);
      all.push(...(page.responses || []));
      pageToken = page.nextPageToken || "";
    } while (pageToken);
    return all;
  }

  function toRow(response, questionMap) {
    const row = { submitted: response.lastSubmittedTime || response.createTime };
    Object.entries(response.answers || {}).forEach(([qid, answer]) => {
      const key = questionMap.get(qid);
      if (key) row[key] = answer.textAnswers?.answers?.[0]?.value ?? "";
    });
    const num = v => (v === undefined || v === "" ? null : Number(v));
    return {
      email: (row.email || "").trim().toLowerCase(),
      sessionId: row.sessionId || `${(row.email || "").trim().toLowerCase()}|${row.date}|${row.routine}|${(row.submitted || "").slice(0, 13)}`,
      date: /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") ? row.date : (row.submitted || "").slice(0, 10),
      routine: (row.routine || "").trim(),
      exercise: (row.exercise || "").trim(),
      setNumber: num(row.setNumber),
      measure: row.measure === "time" ? "time" : "reps",
      reps: num(row.reps),
      durationSeconds: num(row.durationSeconds),
      weightKg: num(row.weightKg),
      rpe: num(row.rpe)
    };
  }

  async function loadData(interactive) {
    if (loading) return;
    if (!FORM.formId) {
      showForkHelp("This site has no form ID configured for trends (form.formId in workouts/config.js).");
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
    $("#user-select").innerHTML = "";
    $("#user-select").disabled = true;
    setStatus("Loading your workouts…");
    try {
      let token = await getToken(false);
      let form;
      try {
        form = await apiGet(encodeURIComponent(FORM.formId), token);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        token = await getToken(true);
        form = await apiGet(encodeURIComponent(FORM.formId), token);
      }
      const questionMap = buildQuestionMap(form);
      if (!new Set(questionMap.values()).has("exercise")) {
        throw new Error("The form's questions don't match the workout tracker fields.");
      }
      const responses = await fetchAllResponses(token);
      allRows = responses.map(r => toRow(r, questionMap)).filter(r => r.exercise);
      loadedAt = new Date();
      renderUserOptions(keepUser);
      applyUser();
    } catch (err) {
      handleLoadError(err, interactive);
    } finally {
      loading = false;
      $("#load-data").disabled = false;
    }
  }

  function handleLoadError(err, interactive) {
    sessionStorage.removeItem(TOKEN_KEY);
    if (err instanceof ApiError) {
      if (err.reason === "SERVICE_DISABLED" || err.reason === "accessNotConfigured") {
        showForkHelp("The Google Forms API isn't enabled in this site's Google Cloud project.");
        setStatus("");
      } else if (err.status === 403 || err.status === 404) {
        showForkHelp(`Your account (${WorkoutAuth.user.email}) doesn't have access to this site's Google Form, or the form wasn't found. ` +
          "If you own this site, check that form.formId in config.js is the ID from the form editor URL (docs.google.com/forms/d/<ID>/edit), not the response spreadsheet's ID.");
        setStatus("");
      } else {
        setStatus(`Google Forms API error: ${err.message}`, "error");
      }
      return;
    }
    if (err.code === "popup_closed" || err.code === "popup_failed_to_open") {
      setStatus(interactive
        ? "The Google permission window was closed or blocked. Allow pop-ups and press Load my data. " +
          "If Google said \"Access blocked … has not completed the Google verification process\", add your account as a test user on the site's OAuth consent screen."
        : "Press Load my data to give read access to your workout data.", interactive ? "error" : "");
    } else if (err.code === "access_denied") {
      setStatus("Read access to the form wasn't granted, so trends can't be shown. Press Load my data to try again.", "error");
    } else {
      setStatus(err.message || String(err), "error");
    }
  }

  // ---------- user filter ----------
  const ALL_USERS = "*";

  function renderUserOptions(previous) {
    const select = $("#user-select");
    const counts = new Map();
    allRows.forEach(r => counts.set(r.email, (counts.get(r.email) || 0) + 1));
    const users = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const me = WorkoutAuth.user.email.toLowerCase();
    const label = email => email || "(no email)";
    select.innerHTML = users.map(([email, n]) =>
      `<option value="${escapeHtml(email)}">${escapeHtml(label(email))}${email === me ? " (you)" : ""} – ${n} set${n === 1 ? "" : "s"}</option>`).join("") +
      (users.length > 1 ? `<option value="${ALL_USERS}">All users – ${allRows.length} sets</option>` : "");
    const values = users.map(([email]) => email);
    if (previous && (values.includes(previous) || (previous === ALL_USERS && users.length > 1))) select.value = previous;
    else if (values.includes(me)) select.value = me;
    else if (values.length) select.value = values[0];
    select.disabled = !users.length;
  }

  function applyUser() {
    const selected = $("#user-select").value;
    rows = selected === ALL_USERS ? allRows : allRows.filter(r => r.email === selected);
    const who = selected === ALL_USERS ? "all users" : (selected || "(no email)");
    const when = loadedAt ? ` Loaded from the form at ${loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.` : "";
    setStatus(allRows.length
      ? `Showing ${rows.length} set${rows.length === 1 ? "" : "s"} (all time) logged by ${who}.${when}`
      : `No workouts have been logged in this form yet.${when}`, allRows.length ? "ok" : "");
    render();
  }

  // ---------- aggregation ----------
  function inRange(list) {
    const days = Number($("#range").value);
    if (!days) return list;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return list.filter(r => r.date >= cutoff);
  }

  function groupBy(list, keyFn) {
    const map = new Map();
    list.forEach(item => {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }

  function setWork(r) {
    if (r.measure === "time") return Number.isFinite(r.durationSeconds) ? r.durationSeconds : 0;
    return Number.isFinite(r.reps) ? r.reps * SECONDS_PER_REP : 0;
  }

  function summarizeSessions(list) {
    return [...groupBy(list, r => r.sessionId).values()].map(sets => {
      const rpes = sets.map(s => s.rpe).filter(Number.isFinite);
      return {
        date: sets[0].date,
        routine: sets[0].routine || "(no routine)",
        sets: sets.length,
        estSeconds: sets.reduce((t, s) => t + setWork(s), 0) + Math.max(0, sets.length - 1) * REST_BETWEEN_SETS,
        avgRpe: avg(rpes)
      };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  // One point per exercise per session.
  function exerciseSessions(list, exercise) {
    return [...groupBy(list.filter(r => r.exercise === exercise), r => r.sessionId).values()].map(sets => {
      const reps = sets.map(s => s.reps).filter(Number.isFinite);
      const times = sets.map(s => s.durationSeconds).filter(Number.isFinite);
      const weights = sets.map(s => s.weightKg).filter(n => Number.isFinite(n) && n > 0);
      const rpes = sets.map(s => s.rpe).filter(Number.isFinite);
      return {
        date: sets[0].date,
        routine: sets[0].routine,
        sets: sets.length,
        totalReps: reps.length ? reps.reduce((a, b) => a + b, 0) : NaN,
        bestReps: reps.length ? Math.max(...reps) : NaN,
        totalTime: times.length ? times.reduce((a, b) => a + b, 0) : NaN,
        bestTime: times.length ? Math.max(...times) : NaN,
        maxWeight: weights.length ? Math.max(...weights) : NaN,
        volume: sets.reduce((t, s) => t + (Number.isFinite(s.reps) && Number.isFinite(s.weightKg) ? s.reps * s.weightKg : 0), 0),
        avgRpe: avg(rpes)
      };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  const METRICS = {
    totalReps: { label: "Total reps", format: v => fmt(v, 0) },
    bestReps: { label: "Best set (reps)", format: v => fmt(v, 0) },
    totalTime: { label: "Total time", format: formatDuration },
    bestTime: { label: "Best set (time)", format: formatDuration },
    maxWeight: { label: "Max weight (kg)", format: v => fmt(v) },
    volume: { label: "Volume (reps × kg)", format: v => fmt(v, 0) },
    avgRpe: { label: "Avg perceived difficulty", format: v => fmt(v) }
  };

  function metricsFor(sessions) {
    return Object.keys(METRICS).filter(key =>
      sessions.some(s => Number.isFinite(s[key]) && (key !== "volume" || s[key] > 0)));
  }

  // ---------- rendering ----------
  function render() {
    const list = inRange(rows);
    $("#results").hidden = false;
    const sessions = summarizeSessions(list);
    renderSummary(list, sessions);
    renderRoutines(sessions);
    renderExerciseOptions(list);
    renderExerciseTrend();
    renderExercisesTable(list);
  }

  function renderSummary(list, sessions) {
    const reps = list.reduce((t, r) => t + (Number.isFinite(r.reps) ? r.reps : 0), 0);
    const timed = list.reduce((t, r) => t + (Number.isFinite(r.durationSeconds) ? r.durationSeconds : 0), 0);
    const est = sessions.reduce((t, s) => t + s.estSeconds, 0);
    const cards = [
      ["Workouts", sessions.length],
      ["Sets", list.length],
      ["Total reps", reps],
      ["Timed work", formatDuration(timed)],
      ["Est. training time", formatDuration(est)],
      ["Avg difficulty", fmt(avg(list.map(r => r.rpe).filter(Number.isFinite)))]
    ];
    $("#summary").innerHTML = cards.map(([label, value]) =>
      `<div class="stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`).join("");
  }

  function renderRoutines(sessions) {
    const groups = [...groupBy(sessions, s => s.routine).entries()]
      .map(([routine, list]) => ({
        routine,
        count: list.length,
        last: list[list.length - 1].date,
        avgSets: avg(list.map(s => s.sets)),
        avgTime: avg(list.map(s => s.estSeconds)),
        avgRpe: avg(list.map(s => s.avgRpe).filter(Number.isFinite)),
        rpeTrend: list.length > 1 ? list[list.length - 1].avgRpe - list[0].avgRpe : NaN
      }))
      .sort((a, b) => b.last.localeCompare(a.last));
    $("#routines-table").innerHTML = groups.length ? `
      <thead><tr><th>Routine</th><th>Workouts</th><th>Last done</th><th>Avg sets</th><th>Avg est. time</th><th>Avg difficulty</th><th>Difficulty change</th></tr></thead>
      <tbody>${groups.map(g => `<tr>
        <td>${escapeHtml(g.routine)}</td><td>${g.count}</td><td>${escapeHtml(g.last)}</td>
        <td>${fmt(g.avgSets)}</td><td>${formatDuration(g.avgTime)}</td><td>${fmt(g.avgRpe)}</td>
        <td>${trendCell(g.rpeTrend, true)}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="muted">No workouts in this period.</td></tr></tbody>`;
  }

  // For difficulty, a falling value at the same workload is the good direction.
  function trendCell(delta, lowerIsBetter = false) {
    if (!Number.isFinite(delta) || delta === 0) return `<span class="muted">–</span>`;
    const good = lowerIsBetter ? delta < 0 : delta > 0;
    return `<span class="${good ? "up" : "down"}">${delta > 0 ? "▲" : "▼"} ${fmt(Math.abs(delta))}</span>`;
  }

  function renderExerciseOptions(list) {
    const select = $("#exercise-select");
    const previous = select.value;
    const counts = [...groupBy(list, r => r.exercise).entries()]
      .map(([name, sets]) => ({ name, sessions: new Set(sets.map(s => s.sessionId)).size }))
      .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
    select.innerHTML = counts.map(c =>
      `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${c.sessions})</option>`).join("");
    if (counts.some(c => c.name === previous)) select.value = previous;
  }

  function renderExerciseTrend() {
    const exercise = $("#exercise-select").value;
    const sessions = exercise ? exerciseSessions(inRange(rows), exercise) : [];
    const metricSelect = $("#metric-select");
    const previous = metricSelect.value;
    const available = metricsFor(sessions);
    metricSelect.innerHTML = available.map(k => `<option value="${k}">${METRICS[k].label}</option>`).join("");
    if (available.includes(previous)) metricSelect.value = previous;
    else metricSelect.value = ["maxWeight", "totalReps", "totalTime"].find(k => available.includes(k)) || available[0] || "";

    const metric = metricSelect.value;

    $("#chart").innerHTML = metric
      ? lineChart(sessions.filter(s => Number.isFinite(s[metric])).map(s => ({ date: s.date, value: s[metric] })), METRICS[metric])
      : `<p class="muted">No data for this exercise in the selected period.</p>`;

    const timed = sessions.some(s => Number.isFinite(s.totalTime));
    $("#exercise-table").innerHTML = sessions.length ? `
      <thead><tr><th>Date</th><th>Routine</th><th>Sets</th>
        <th>${timed ? "Total time" : "Total reps"}</th><th>${timed ? "Best set" : "Best set (reps)"}</th>
        <th>Max weight</th><th>Avg difficulty</th></tr></thead>
      <tbody>${sessions.slice().reverse().map(s => `<tr>
        <td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.routine || "–")}</td><td>${s.sets}</td>
        <td>${timed ? formatDuration(s.totalTime) : fmt(s.totalReps, 0)}</td>
        <td>${timed ? formatDuration(s.bestTime) : fmt(s.bestReps, 0)}</td>
        <td>${Number.isFinite(s.maxWeight) ? `${fmt(s.maxWeight)} kg` : "–"}</td>
        <td>${fmt(s.avgRpe)}</td></tr>`).join("")}</tbody>` : "";
  }

  function renderExercisesTable(list) {
    const groups = [...groupBy(list, r => r.exercise).keys()].map(name => {
      const sessions = exerciseSessions(list, name);
      const timed = sessions.some(s => Number.isFinite(s.totalTime));
      const key = timed ? "totalTime" : "totalReps";
      const first = sessions[0];
      const last = sessions[sessions.length - 1];
      return {
        name, timed, count: sessions.length, lastDate: last.date,
        latest: last[key], change: sessions.length > 1 ? last[key] - first[key] : NaN,
        maxWeight: Math.max(...sessions.map(s => s.maxWeight).filter(Number.isFinite), -Infinity),
        avgRpe: avg(sessions.map(s => s.avgRpe).filter(Number.isFinite))
      };
    }).sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));

    $("#exercises-table").innerHTML = groups.length ? `
      <thead><tr><th>Exercise</th><th>Workouts</th><th>Last done</th><th>Latest total</th><th>Change</th><th>Max weight</th><th>Avg difficulty</th></tr></thead>
      <tbody>${groups.map(g => `<tr>
        <td><a href="#" class="ex-link" data-name="${escapeHtml(g.name)}">${escapeHtml(g.name)}</a></td>
        <td>${g.count}</td><td>${escapeHtml(g.lastDate)}</td>
        <td>${g.timed ? formatDuration(g.latest) : `${fmt(g.latest, 0)} reps`}</td>
        <td>${g.timed ? timeTrendCell(g.change) : trendCell(g.change)}</td>
        <td>${Number.isFinite(g.maxWeight) ? `${fmt(g.maxWeight)} kg` : "–"}</td>
        <td>${fmt(g.avgRpe)}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="muted">No exercises in this period.</td></tr></tbody>`;
  }

  function timeTrendCell(delta) {
    if (!Number.isFinite(delta) || delta === 0) return `<span class="muted">–</span>`;
    return `<span class="${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"} ${formatDuration(Math.abs(delta))}</span>`;
  }

  // ---------- SVG line chart ----------
  function lineChart(points, metric) {
    if (!points.length) return `<p class="muted">No data for this metric.</p>`;
    const W = 640, H = 260, pad = { l: 56, r: 16, t: 16, b: 40 };
    const days = points.map(p => Date.parse(p.date));
    const minX = Math.min(...days), maxX = Math.max(...days);
    const values = points.map(p => p.value);
    let minY = Math.min(0, ...values), maxY = Math.max(...values);
    if (maxY === minY) maxY = minY + 1;
    maxY += (maxY - minY) * 0.1;
    const x = d => pad.l + (maxX === minX ? (W - pad.l - pad.r) / 2 : ((d - minX) / (maxX - minX)) * (W - pad.l - pad.r));
    const y = v => H - pad.b - ((v - minY) / (maxY - minY)) * (H - pad.t - pad.b);

    const ticks = 4;
    const grid = Array.from({ length: ticks + 1 }, (_, i) => {
      const v = minY + ((maxY - minY) * i) / ticks;
      return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
        <text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${escapeHtml(metric.format(v))}</text>`;
    }).join("");
    const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    const anchor = d => (maxX === minX ? "middle" : d === minX ? "start" : d === maxX ? "end" : "middle");
    const xLabels = labelIdx.map(i =>
      `<text x="${x(days[i])}" y="${H - pad.b + 24}" text-anchor="${anchor(days[i])}">${escapeHtml(points[i].date)}</text>`).join("");
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(days[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    const dots = points.map((p, i) =>
      `<circle cx="${x(days[i])}" cy="${y(p.value)}" r="4"><title>${escapeHtml(p.date)}: ${escapeHtml(metric.format(p.value))}</title></circle>`).join("");

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(metric.label)} over time">
      ${grid}${xLabels}<path d="${path}" class="line"/>${dots}</svg>`;
  }

  // ---------- boot ----------
  function onSignIn() {
    $("#trends-view").hidden = false;
    if (!FORM.formId) {
      showForkHelp("This site has no form ID configured for trends (form.formId in workouts/config.js).");
      $("#load-data").disabled = true;
      return;
    }
    // Without a cached token, wait for a click so the Google consent popup isn't blocked.
    if (cachedToken()) loadData(false);
    else setStatus("Press Load my data to read your workouts from the Google Form.");
  }

  function onSignOut() {
    sessionStorage.removeItem(TOKEN_KEY);
    rows = [];
    allRows = [];
    $("#user-select").innerHTML = "";
    $("#user-select").disabled = true;
    $("#trends-view").hidden = true;
    $("#results").hidden = true;
    $("#fork-help").hidden = true;
    setStatus("");
  }

  $("#load-data").addEventListener("click", () => loadData(true));
  $("#range").addEventListener("change", () => allRows.length && render());
  $("#user-select").addEventListener("change", applyUser);
  $("#exercise-select").addEventListener("change", renderExerciseTrend);
  $("#metric-select").addEventListener("change", renderExerciseTrend);
  $("#exercises-table").addEventListener("click", event => {
    const link = event.target.closest(".ex-link");
    if (!link) return;
    event.preventDefault();
    $("#exercise-select").value = link.dataset.name;
    renderExerciseTrend();
    $("#chart").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  WorkoutAuth.init({ onSignIn, onSignOut });
})();
