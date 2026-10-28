(() => {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function getLocalDateString(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function confirmFutureDate(date, today = getLocalDateString()) {
    if (date <= today) {
      return true;
    }

    return window.confirm(`The selected date (${date}) is in the future. Submit anyway?`);
  }

  window.WorkoutUtilities = { escapeHtml, getLocalDateString, confirmFutureDate };
})();
