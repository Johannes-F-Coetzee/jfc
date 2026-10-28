const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "utilities.js"), "utf8");
const window = {};
runInNewContext(source, { window });

test("escapes all HTML-sensitive characters and empty values", () => {
  assert.equal(window.WorkoutUtilities.escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(window.WorkoutUtilities.escapeHtml(null), "");
  assert.equal(window.WorkoutUtilities.escapeHtml(undefined), "");
});

test("formats a local date using the date's timezone offset", () => {
  const date = {
    getTime: () => Date.UTC(2026, 0, 1, 1),
    getTimezoneOffset: () => 120
  };
  assert.equal(window.WorkoutUtilities.getLocalDateString(date), "2025-12-31");
});

test("confirms future dates while allowing today and earlier dates without a prompt", () => {
  const confirmations = [];
  window.confirm = message => {
    confirmations.push(message);

    return false;
  };

  assert.equal(window.WorkoutUtilities.confirmFutureDate("2026-10-27", "2026-10-28"), true);
  assert.equal(window.WorkoutUtilities.confirmFutureDate("2026-10-28", "2026-10-28"), true);
  assert.equal(window.WorkoutUtilities.confirmFutureDate("2026-10-29", "2026-10-28"), false);
  assert.deepEqual(confirmations, [
    "The selected date (2026-10-29) is in the future. Submit anyway?"
  ]);
});
