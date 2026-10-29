(() => {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  // Markup that is already safe to insert. `html` escapes every other interpolated value.
  class SafeHtml {
    constructor(value) {
      this.value = value;
    }

    toString() {
      return this.value;
    }
  }

  function renderHtmlValue(value) {
    if (value instanceof SafeHtml) {
      return value.value;
    }

    return Array.isArray(value) ? value.map(renderHtmlValue).join("") : escapeHtml(value);
  }

  // Tagged template that escapes interpolations; arrays are joined and nested `html` results are kept as-is.
  function html(strings, ...values) {
    return new SafeHtml(strings.reduce((markup, text, index) =>
      markup + text + (index < values.length ? renderHtmlValue(values[index]) : ""), ""));
  }

  function rawHtml(markup) {
    return new SafeHtml(String(markup));
  }

  function setHtml(element, markup) {
    element.innerHTML = String(markup);
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

  window.WorkoutUtilities = { escapeHtml, html, rawHtml, setHtml, getLocalDateString, confirmFutureDate };
})();
