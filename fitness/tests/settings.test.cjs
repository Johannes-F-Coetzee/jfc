const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const source = readFileSync(path.join(__dirname, "..", "settings.js"), "utf8");
const themes = [
  "dark-red", "dark-green", "dark-blue", "dark-grey",
  "light-red", "light-green", "light-blue", "light-grey"
];
const stylesheet = readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

function renderAssets(filename, timestamp) {
  const markup = readFileSync(path.join(__dirname, "..", filename), "utf8");
  const bootstrap = /<script>\s*([\s\S]*?)<\/script>/.exec(markup);
  const writtenMarkup = [];

  assert.ok(bootstrap, `${filename}: inline asset bootstrap`);
  runInNewContext(bootstrap[1], {
    Date: { now: () => timestamp },
    document: { write: value => writtenMarkup.push(value) }
  });

  return writtenMarkup.join("");
}

function themeColors(theme) {
  const colors = {};
  const selectors = [":root"];

  if (theme.startsWith("light-")) {
    selectors.push(':root[data-theme^="light-"]');
  }

  selectors.push(`:root[data-theme="${theme}"]`);
  for (const selector of selectors) {
    const start = stylesheet.indexOf(`${selector} {`);

    if (start === -1) {
      continue;
    }

    const block = stylesheet.slice(start, stylesheet.indexOf("}", start));

    for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      colors[match[1]] = match[2].trim();
    }
  }

  return colors;
}

function createEnvironment(savedTheme = null, options = {}) {
  const events = {};
  const changes = {};
  const storage = new Map(savedTheme === null ? [] : [["workout.theme", savedTheme]]);
  if (options.units !== undefined) storage.set("workout.units", options.units);
  if (options.defaultMeasure !== undefined) storage.set("workout.defaultMeasure", options.defaultMeasure);
  const messages = [];
  let focused = false;
  const selector = {
    value: "",
    addEventListener: (name, callback) => { changes[name] = callback; }
  };
  const status = { textContent: "" };
  const favicon = { href: "excersise_favicon.svg" };
  const unitsChanges = {};
  const unitsSelector = {
    value: "",
    addEventListener: (name, callback) => { unitsChanges[name] = callback; }
  };
  const measureChanges = {};
  const measureSelector = {
    value: "",
    addEventListener: (name, callback) => { measureChanges[name] = callback; }
  };
  const menu = {
    open: false,
    contains: target => target === selector,
    querySelector: () => ({ focus: () => { focused = true; } })
  };
  const elements = {
    "#settings-menu": menu, "#theme-select": selector, "#settings-status": status,
    "#units-select": unitsSelector, "#default-measure-select": measureSelector,
    'link[rel="icon"]': favicon
  };
  const document = {
    documentElement: { dataset: {} },
    querySelector: name => elements[name],
    addEventListener: (name, callback) => { events[name] = callback; },
    dispatchEvent: event => { if (events[event.type]) events[event.type](event); }
  };
  const window = {};

  runInNewContext(source, {
    document, window,
    getComputedStyle: element => ({
      getPropertyValue: property => themeColors(element.dataset.theme)[property] || ""
    }),
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
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
    document, selector, unitsSelector, measureSelector, settings: window.WorkoutSettings,
    status, favicon, menu, storage, messages, events,
    get focused() { return focused; },
    initialize: () => events.DOMContentLoaded(),
    select: value => { selector.value = value; changes.change(); },
    selectUnits: value => { unitsSelector.value = value; unitsChanges.change(); },
    selectMeasure: value => { measureSelector.value = value; measureChanges.change(); }
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
  test(`${theme} favicon uses the page palette on load and theme change`, () => {
    const colors = themeColors(theme);
    const restored = createEnvironment(theme);
    restored.initialize();
    const environment = createEnvironment();
    environment.initialize();
    environment.select(theme);
    assert.equal(environment.favicon.href, restored.favicon.href);
    assert.ok(environment.favicon.href.startsWith("data:image/svg+xml,"));
    const image = decodeURIComponent(environment.favicon.href.split(",")[1]);
    assert.ok(image.includes(`fill="${colors["--bg"]}"`));
    assert.ok(image.includes(`stroke="${colors["--text"]}"`));
    assert.ok(image.includes(`stroke="${colors["--accent"]}"`));
    assert.equal((image.match(/<circle /g) || []).length, 2);
  });

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
  const originalFavicon = environment.favicon.href;
  environment.select("light-green");
  assert.notEqual(environment.favicon.href, originalFavicon);
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

test("fitness pages load the shared header and keep page-specific navigation", () => {
  const timestamp = 1740000000000;
  const expectedVersion = Math.floor(timestamp / (5 * 60 * 1000));
  const sharedHeader = readFileSync(path.join(__dirname, "..", "shared-header.js"), "utf8");

  for (const filename of ["index.html", "trends.html", "track.html"]) {
    const html = readFileSync(path.join(__dirname, "..", filename), "utf8");
    const pageScript = filename === "index.html" ? "app.js" : filename.replace(".html", ".js");
    const pageName = filename === "index.html" ? "log" : filename.replace(".html", "");
    const assets = renderAssets(filename, timestamp);
    const assetUrls = [...assets.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
    const expectedSuffix = `?v=${expectedVersion}`;
    const sharedHeaderScriptIndex = assets.indexOf(`<script src="shared-header.js${expectedSuffix}" defer></script>`);
    const utilitiesScriptIndex = assets.indexOf(`<script src="utilities.js${expectedSuffix}" defer></script>`);

    assert.ok(assetUrls.length > 0, `${filename}: generated static asset URLs`);
    assert.ok(assetUrls.every(url => url.endsWith(expectedSuffix)), `${filename}: shared five-minute version`);
    assert.ok(assets.indexOf(`<script src="settings.js${expectedSuffix}"></script>`) <
      assets.indexOf(`<link rel="stylesheet" href="styles.css${expectedSuffix}">`));
    assert.notEqual(sharedHeaderScriptIndex, -1, `${filename}: shared header script`);
    assert.ok(sharedHeaderScriptIndex < utilitiesScriptIndex, `${filename}: header before page initialization`);
    assert.notEqual(utilitiesScriptIndex, -1, `${filename}: shared utilities`);
    assert.ok(utilitiesScriptIndex < assets.indexOf(`<script src="${pageScript}${expectedSuffix}" defer></script>`));
    assert.ok(assets.includes(`<link rel="icon" href="excersise_favicon.svg${expectedSuffix}" type="image/svg+xml">`));
    assert.ok(html.includes(`<header id="fitness-header" class="topbar" data-page="${pageName}"></header>`));
    assert.match(sharedHeader, /<details id="settings-menu"/);
    assert.match(sharedHeader, /<select id="units-select">/);
    assert.match(sharedHeader, /<option value="metric">Metric \(kg, cm, L\)<\/option>/);
    assert.match(sharedHeader, /<option value="imperial">Imperial \(lb, in, fl oz\)<\/option>/);
    assert.match(sharedHeader, /<select id="default-measure-select" aria-describedby="default-measure-help">/);
    assert.match(sharedHeader, /<option value="reps">Reps<\/option>/);
    assert.match(sharedHeader, /<option value="time">Time<\/option>/);
    for (const theme of themes) {
      assert.ok(sharedHeader.includes(`<option value="${theme}">`), theme);
    }
  }
});

test("asset cache version remains stable within a five-minute window and changes at its boundary", () => {
  for (const filename of ["index.html", "trends.html", "track.html"]) {
    const firstInstantInWindow = renderAssets(filename, 300001);
    const lastInstantInWindow = renderAssets(filename, 599999);
    const nextWindow = renderAssets(filename, 600000);
    const versionFrom = markup => /\?v=(\d+)/.exec(markup)?.[1];

    assert.equal(versionFrom(firstInstantInWindow), "1");
    assert.equal(versionFrom(lastInstantInWindow), "1");
    assert.equal(versionFrom(nextWindow), "2");
    assert.notEqual(versionFrom(firstInstantInWindow), versionFrom(nextWindow));
  }
});

test("Metric is the default and conversions preserve kilograms", () => {
  const environment = createEnvironment();
  environment.initialize();
  assert.equal(environment.unitsSelector.value, "metric");
  assert.equal(environment.settings.units, "metric");
  assert.equal(environment.settings.weightUnit, "kg");
  assert.equal(environment.settings.weightFromKg(100), 100);
  assert.equal(environment.settings.weightToKg(100), 100);
  assert.equal(environment.settings.weightToKg(100, "imperial"), 45.359237);
  assert.equal(environment.settings.weightFromKg(45.359237, "imperial"), 100);
});

for (const units of ["metric", "imperial"]) {
  test(`${units} units persist across pages and notify listeners after applying`, () => {
    const environment = createEnvironment();
    environment.initialize();
    let previousUnits;
    environment.events["workout:unitschange"] = event => {
      previousUnits = event.detail.previousUnits;
      assert.equal(environment.settings.units, units);
    };
    environment.selectUnits(units);
    assert.equal(previousUnits, "metric");
    assert.equal(environment.storage.get("workout.units"), units);
    assert.match(environment.status.textContent, /Units saved/);
    assert.equal(environment.settings.weightUnit, units === "imperial" ? "lb" : "kg");
    const restored = createEnvironment(null, { units: environment.storage.get("workout.units") });
    restored.initialize();
    assert.equal(restored.unitsSelector.value, units);
    assert.equal(restored.settings.units, units);
    for (const weight of [0, 0.5, 20, 45.359237, 100]) {
      assert.ok(Math.abs(restored.settings.weightToKg(restored.settings.weightFromKg(weight)) - weight) < 1e-10);
    }
  });
}

test("unsupported units are reported and fall back to Metric", () => {
  const environment = createEnvironment(null, { units: "unsupported" });
  environment.initialize();
  assert.equal(environment.settings.units, "metric");
  assert.equal(environment.unitsSelector.value, "metric");
  assert.match(environment.status.textContent, /saved units are not supported/);
  assert.equal(environment.messages.length, 1);
});

test("units apply when storage is unavailable without claiming persistence", () => {
  const environment = createEnvironment(null, { failWrite: true });
  environment.initialize();
  environment.selectUnits("imperial");
  assert.equal(environment.settings.units, "imperial");
  assert.equal(environment.settings.weightToKg(100), 45.359237);
  assert.equal(environment.storage.has("workout.units"), false);
  assert.match(environment.status.textContent, /Units applied, but could not be saved/);
  assert.equal(environment.messages.length, 1);
});

test("Reps is the default exercise measure before the UI initializes", () => {
  const environment = createEnvironment();
  assert.equal(environment.settings.defaultMeasure, "reps");
  environment.initialize();
  assert.equal(environment.measureSelector.value, "reps");
});

for (const defaultMeasure of ["reps", "time"]) {
  test(`${defaultMeasure} default measure applies and persists across pages`, () => {
    const environment = createEnvironment();
    environment.initialize();
    environment.selectMeasure(defaultMeasure);
    assert.equal(environment.settings.defaultMeasure, defaultMeasure);
    assert.equal(environment.storage.get("workout.defaultMeasure"), defaultMeasure);
    assert.match(environment.status.textContent, /Default measure saved/);
    const restored = createEnvironment(null, {
      defaultMeasure: environment.storage.get("workout.defaultMeasure")
    });
    assert.equal(restored.settings.defaultMeasure, defaultMeasure);
    restored.initialize();
    assert.equal(restored.measureSelector.value, defaultMeasure);
  });
}

test("unsupported default measures are reported and fall back to Reps", () => {
  const environment = createEnvironment(null, { defaultMeasure: "unsupported" });
  environment.initialize();
  assert.equal(environment.settings.defaultMeasure, "reps");
  assert.equal(environment.measureSelector.value, "reps");
  assert.match(environment.status.textContent, /saved default measure is not supported/);
  assert.equal(environment.messages.length, 1);
});

test("default measure applies when storage fails without claiming persistence", () => {
  const environment = createEnvironment(null, { failWrite: true });
  environment.initialize();
  environment.selectMeasure("time");
  assert.equal(environment.settings.defaultMeasure, "time");
  assert.equal(environment.storage.has("workout.defaultMeasure"), false);
  assert.match(environment.status.textContent, /Default measure applied, but could not be saved/);
  assert.equal(environment.messages.length, 1);
});
