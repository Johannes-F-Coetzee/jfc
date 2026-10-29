(() => {
  "use strict";

  const PAGE_CONFIGURATIONS = {
    log: { title: "Workout log" },
    track: { title: "Track" },
    trends: { title: "Trends" }
  };
  const header = document.querySelector("#fitness-header");
  const page = header?.dataset.page;
  const pageConfiguration = PAGE_CONFIGURATIONS[page];

  if (!pageConfiguration) {
    return;
  }

  header.innerHTML = `
    <a class="brand" href="../">&larr; Home</a>
    <h1>${pageConfiguration.title}</h1>
    <nav class="nav" aria-label="Fitness pages">
      <a href="./" data-page="log">Log</a>
      <a href="track.html" data-page="track">Track</a>
      <a href="trends.html" data-page="trends">Trends</a>
    </nav>
    <details id="settings-menu" class="settings-menu">
      <summary class="btn ghost small" title="Settings"><span class="settings-icon"
        aria-hidden="true">&#9881;</span><span class="settings-text">Settings</span></summary>
      <div class="settings-panel card">
        <h2>Settings</h2>
        <label class="field" for="theme-select">Theme
          <select id="theme-select">
            <optgroup label="Dark">
              <option value="dark-red">Dark Red</option>
              <option value="dark-green">Dark Green</option>
              <option value="dark-blue">Dark Blue</option>
              <option value="dark-grey">Dark Grey</option>
            </optgroup>
            <optgroup label="Light">
              <option value="light-red">Light Red</option>
              <option value="light-green">Light Green</option>
              <option value="light-blue">Light Blue</option>
              <option value="light-grey">Light Grey</option>
            </optgroup>
          </select>
        </label>
        <label class="field" for="units-select">Units
          <select id="units-select">
            <option value="metric">Metric (kg, cm, L)</option>
            <option value="imperial">Imperial (lb, in, fl oz)</option>
          </select>
        </label>
        <label class="field" for="default-measure-select">Default exercise measure
          <select id="default-measure-select" aria-describedby="default-measure-help">
            <option value="reps">Reps</option>
            <option value="time">Time</option>
          </select>
        </label>
        <p id="default-measure-help" class="muted">Used for new exercises only. Existing exercises and saved
          configurations keep their measure.</p>
        <p class="muted">Settings are remembered on this device across fitness pages.</p>
        <p id="settings-status" class="status" role="status" aria-live="polite"></p>
      </div>
    </details>
    <div id="user-box" class="user-box" hidden>
      <img id="user-avatar" alt="" referrerpolicy="no-referrer">
      <span id="user-name"></span>
      <button type="button" id="sign-out" class="btn ghost small">Sign out</button>
    </div>`;

  header.querySelectorAll(".nav a").forEach(link => {
    if (link.dataset.page === page) {
      link.setAttribute("aria-current", "page");
    }
  });
})();