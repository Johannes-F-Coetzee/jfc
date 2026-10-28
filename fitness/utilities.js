(() => {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function getLocalDateString(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  window.WorkoutUtilities = { escapeHtml, getLocalDateString };
})();
