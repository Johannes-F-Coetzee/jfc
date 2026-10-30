const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { readSource } = require("./helpers.cjs");

function renderHeader(page) {
  const links = [];
  const header = {
    dataset: { page },
    innerHTML: "",
    querySelectorAll() {
      links.length = 0;
      [...this.innerHTML.matchAll(/<a [^>]*data-page="([^"]+)"[^>]*>/g)].forEach(match => links.push({
        page: match[1], dataset: { page: match[1] }, current: false,
        setAttribute(name, value) { this.current = this.current || (name === "aria-current" && value === "page"); }
      }));

      return links;
    }
  };
  runInNewContext(readSource("shared-header.js"), {
    document: { querySelector: selector => (selector === "#fitness-header" && page !== "missing" ? header : null) }
  });

  return { header, links };
}

test("the shared header titles each page and marks only its own nav link as current", () => {
  for (const [page, title] of [["log", "Workout log"], ["track", "Track"], ["plan", "Plan"], ["trends", "Trends"]]) {
    const { header, links } = renderHeader(page);

    assert.match(header.innerHTML, new RegExp(`<h1>${title}</h1>`), page);
    assert.deepEqual(links.filter(link => link.current).map(link => link.page), [page], `${page} current link`);
  }
});

test("the shared header leaves unknown pages and missing placeholders alone", () => {
  assert.equal(renderHeader("nonsense").header.innerHTML, "");
  assert.doesNotThrow(() => renderHeader("missing"));
});

test("every header nav link points at a page that exists", () => {
  const { header } = renderHeader("log");
  const hrefs = [...header.innerHTML.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1]);

  for (const href of new Set(hrefs)) {
    const target = href === "./" ? "index.html" : href;

    assert.ok(href === "../" || existsSync(path.join(__dirname, "..", target)), `${href} exists`);
  }
});

test("the header exposes every control the sign-in module and settings module look up", () => {
  const { header } = renderHeader("log");

  for (const id of ["settings-menu", "theme-select", "units-select", "default-measure-select", "user-box",
    "user-avatar", "user-name", "sign-out", "settings-status"]) {
    assert.match(header.innerHTML, new RegExp(`id="${id}"`), id);
  }
});

function loadStatus() {
  const window = {};
  runInNewContext(readSource("submission-status.js"), { window });

  return window.WorkoutSubmissionStatus;
}

test("submission status messages name their subject and say sent, not stored", () => {
  const status = loadStatus();

  assert.equal(status.submitting("workout"), "Submitting workout…");
  assert.equal(status.sent("measurement"), "Measurement submission sent.");
  assert.match(status.queued("workout"), /^Workout submission is saved on this device and will be sent automatically/);
  assert.equal(status.retrying("measurement"), "Retrying pending measurement submissions…");
  assert.equal(status.retrySent("workout"), "Pending workout submissions sent.");
  assert.match(status.retryQueued("workout"), /remain queued on this device/);

  for (const message of [status.sent("workout"), status.retrySent("workout")]) {
    assert.doesNotMatch(message, /confirmed|stored|saved to google/i);
  }
});

test("setting a status replaces its text and keeps a single kind class", () => {
  const status = loadStatus();
  const element = { textContent: "old", className: "status ok" };

  status.set(element, "Failed", "error");
  assert.equal(element.textContent, "Failed");
  assert.equal(element.className, "status error");
  status.set(element, "Neutral");
  assert.equal(element.className.trim(), "status");
});
