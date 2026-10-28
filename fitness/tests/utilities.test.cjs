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
