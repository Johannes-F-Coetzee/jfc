const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "settings.js"), "utf8");
const themes = [
  "dark-red", "dark-green", "dark-blue",
  "light-red", "light-green", "light-blue"
];

function createEnvironment(savedTheme = null, options = {}) {
  const events = {};
  const changes = {};
  const storage = new Map(savedTheme === null ? [] : [["workout.theme", savedTheme]]);
  const messages = [];
  let focused = false;
  const selector = {
    value: "",
    addEventListener: (name, callback) => { changes[name] = callback; }
  };
  const status = { textContent: "" };
  const menu = {
    open: false,
    contains: target => target === selector,
    querySelector: () => ({ focus: () => { focused = true; } })
  };
  const elements = {
    "#settings-menu": menu, "#theme-select": selector, "#settings-status": status
  };
  const document = {
    documentElement: { dataset: {} },
    querySelector: name => elements[name],
    addEventListener: (name, callback) => { events[name] = callback; }
  };

  runInNewContext(source, {
    document,
    console: {
      warn: message => messages.push(message),
      error: message => messages.push(message)
    },
    localStorage: {
      getItem: key => {
        if (options.failRead) throw new Error("Storage blocked");
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (options.failWrite) throw new Error("Storage full");
        storage.set(key, value);
      }
    }
  });

  return {
    document, selector, status, menu, storage, messages, events,
    get focused() { return focused; },
    initialize: () => events.DOMContentLoaded(),
    select: value => { selector.value = value; changes.change(); }
  };
}

test("Dark Red is applied before the settings UI initializes", () => {
  const environment = createEnvironment();
  assert.equal(environment.document.documentElement.dataset.theme, "dark-red");
  environment.initialize();
  assert.equal(environment.selector.value, "dark-red");
  assert.equal(environment.status.textContent, "");
});

for (const theme of themes) {
  test(`${theme} applies, persists, and restores on another page`, () => {
    const environment = createEnvironment();
    environment.initialize();
    environment.select(theme);
    assert.equal(environment.document.documentElement.dataset.theme, theme);
    assert.equal(environment.storage.get("workout.theme"), theme);
    assert.match(environment.status.textContent, /saved/);

    const restored = createEnvironment(environment.storage.get("workout.theme"));
    assert.equal(restored.document.documentElement.dataset.theme, theme);
    restored.initialize();
    assert.equal(restored.selector.value, theme);
  });
}

test("an unsupported saved theme is reported and uses Dark Red", () => {
  const environment = createEnvironment("unsupported");
  environment.initialize();
  assert.equal(environment.selector.value, "dark-red");
  assert.match(environment.status.textContent, /not supported/);
  assert.equal(environment.messages.length, 1);
});

test("storage read failures are reported without preventing theme changes", () => {
  const environment = createEnvironment(null, { failRead: true });
  environment.initialize();
  assert.match(environment.status.textContent, /could not be read/);
  environment.select("light-blue");
  assert.equal(environment.document.documentElement.dataset.theme, "light-blue");
  assert.equal(environment.messages.length, 1);
});

test("storage write failures apply the theme but do not claim it was saved", () => {
  const environment = createEnvironment(null, { failWrite: true });
  environment.initialize();
  environment.select("light-green");
  assert.equal(environment.document.documentElement.dataset.theme, "light-green");
  assert.equal(environment.storage.has("workout.theme"), false);
  assert.match(environment.status.textContent, /could not be saved/);
  assert.equal(environment.messages.length, 1);
});

test("Escape closes settings and restores focus; outside clicks dismiss it", () => {
  const environment = createEnvironment();
  environment.initialize();
  environment.menu.open = true;
  environment.events.click({ target: environment.selector });
  assert.equal(environment.menu.open, true);
  environment.events.keydown({ key: "Escape" });
  assert.equal(environment.menu.open, false);
  assert.equal(environment.focused, true);
  environment.menu.open = true;
  environment.events.click({ target: {} });
  assert.equal(environment.menu.open, false);
});

test("both pages load settings before styles and offer all six themes", () => {
  for (const filename of ["index.html", "trends.html"]) {
    const html = readFileSync(path.join(__dirname, "..", filename), "utf8");
    assert.ok(html.indexOf('src="settings.js"') < html.indexOf('href="styles.css"'));
    assert.match(html, /<details id="settings-menu"/);
    for (const theme of themes) {
      assert.ok(html.includes(`<option value="${theme}">`), `${filename}: ${theme}`);
    }
  }
});
