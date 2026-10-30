const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { readSource } = require("./helpers.cjs");

const PAGES = ["index.html", "track.html", "plan.html", "trends.html"];
const SHARED_HEADER = readSource("shared-header.js");

const idsIn = markup => [...markup.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const scriptsOf = markup => [...markup.matchAll(/versionedScript\("([^"]+)"/g)].map(match => match[1]);

// Ids that scripts look up but that are created at run time rather than written in the HTML.
const DYNAMIC_IDS = new Set([]);

test("every page is a complete, mobile-ready document with a title", () => {
  for (const page of PAGES) {
    const markup = readSource(page);

    assert.match(markup, /^<!doctype html>/i, page);
    assert.match(markup, /<html lang="en">/, page);
    assert.match(markup, /<meta charset="utf-8">/i, page);
    assert.match(markup, /<meta name="viewport" content="width=device-width, initial-scale=1">/, page);
    assert.match(markup, /<title>[^<]+<\/title>/, page);
  }
});

test("ids are unique within each page, including those the shared header adds", () => {
  for (const page of PAGES) {
    const ids = [...idsIn(readSource(page)), ...idsIn(SHARED_HEADER)];
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

    assert.deepEqual(duplicates, [], `${page} has duplicate ids`);
  }
});

test("every page mounts the shared header for a page the header knows about", () => {
  for (const page of PAGES) {
    const dataPage = /<header id="fitness-header"[^>]*data-page="([^"]+)"/.exec(readSource(page))?.[1];

    assert.ok(dataPage, `${page} has a shared header placeholder`);
    assert.match(SHARED_HEADER, new RegExp(`${dataPage}: \\{ title:`), `${page} header title`);
    assert.match(SHARED_HEADER, new RegExp(`data-page="${dataPage}"`), `${page} nav link`);
  }
});

test("every script a page loads exists, and each page loads auth, forms and its own script", () => {
  for (const page of PAGES) {
    const scripts = scriptsOf(readSource(page));
    const own = page === "index.html" ? "app.js" : page.replace(".html", ".js");

    for (const required of ["settings.js", "config.js", "shared-header.js", "utilities.js", "auth.js", "google-forms.js", own]) {
      assert.ok(scripts.includes(required), `${page} loads ${required}`);
    }

    for (const script of scripts) {
      assert.ok(existsSync(path.join(__dirname, "..", script)), `${page}: ${script} exists`);
    }
  }
});

test("scripts load in dependency order: shared modules before the modules that use them", () => {
  const dependencies = {
    "utilities.js": [], "auth.js": [], "google-forms.js": ["auth.js"], "submission-status.js": [],
    "routines.js": ["google-forms.js"], "plans.js": ["google-forms.js"],
    "app.js": ["utilities.js", "auth.js", "google-forms.js", "submission-status.js", "routines.js"],
    "track.js": ["utilities.js", "auth.js", "google-forms.js", "submission-status.js"],
    "plan.js": ["utilities.js", "auth.js", "routines.js", "plans.js"],
    "trends.js": ["utilities.js", "auth.js", "google-forms.js"]
  };

  for (const page of PAGES) {
    const scripts = scriptsOf(readSource(page));

    for (const script of scripts.filter(name => dependencies[name])) {
      for (const dependency of dependencies[script]) {
        assert.ok(scripts.indexOf(dependency) !== -1 && scripts.indexOf(dependency) < scripts.indexOf(script),
          `${page}: ${dependency} must load before ${script}`);
      }
    }

    assert.ok(scripts.indexOf("settings.js") < scripts.indexOf("config.js") + 1, `${page}: settings first`);
    assert.ok(scripts.indexOf("shared-header.js") < scripts.indexOf("auth.js"), `${page}: header before auth`);
  }
});

test("every element a page script looks up by id exists on that page", () => {
  for (const page of PAGES) {
    const markup = readSource(page);
    const available = new Set([...idsIn(markup), ...idsIn(SHARED_HEADER), ...DYNAMIC_IDS]);
    const missing = [];

    for (const script of scriptsOf(markup).filter(name => !["config.js", "settings.js"].includes(name))) {
      for (const match of readSource(script).matchAll(/["'`]#([A-Za-z][\w-]*)["'`]/g)) {
        if (!available.has(match[1])) {
          missing.push(`${script}: #${match[1]}`);
        }
      }
    }

    assert.deepEqual([...new Set(missing)], [], `${page} is missing elements its scripts use`);
  }
});

test("labels and ARIA references point at elements that exist", () => {
  for (const page of PAGES) {
    const markup = readSource(page);
    const available = new Set([...idsIn(markup), ...idsIn(SHARED_HEADER)]);
    const references = [
      ...[...markup.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(match => match[1]),
      ...[...markup.matchAll(/aria-(?:describedby|labelledby|controls)="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/))
    ];

    assert.deepEqual(references.filter(id => !available.has(id)), [], `${page} has dangling references`);
  }
});

test("each page has exactly one top-level h1 (from the shared header) and every form control is labelled", () => {
  for (const page of PAGES) {
    const markup = readSource(page);

    assert.equal((markup.match(/<h1[\s>]/g) || []).length, 0, `${page} leaves the h1 to the shared header`);
    assert.equal((SHARED_HEADER.match(/<h1>/g) || []).length, 1);

    for (const control of markup.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      const attributes = control[2];

      if (/type="(hidden|submit|button)"/.test(attributes)) {
        continue;
      }

      const id = /\sid="([^"]+)"/.exec(attributes)?.[1];
      const labelled = /aria-label(ledby)?=/.test(attributes) ||
        (id && new RegExp(`<label[^>]*\\sfor="${id}"`).test(markup));
      // A control nested inside its <label> is labelled by it; look for an enclosing label before the control.
      const before = markup.slice(0, control.index);
      const insideLabel = before.lastIndexOf("<label") > before.lastIndexOf("</label>");

      assert.ok(labelled || insideLabel, `${page}: <${control[1]}${id ? ` id="${id}"` : ""}> needs a label`);
    }
  }
});

test("the stylesheet is balanced and defines every theme the settings menu offers", () => {
  const css = readSource("styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length, "unbalanced braces");
  assert.equal((css.match(/\(/g) || []).length, (css.match(/\)/g) || []).length, "unbalanced parentheses");

  for (const theme of [...SHARED_HEADER.matchAll(/<option value="((?:dark|light)-[a-z]+)">/g)].map(match => match[1])) {
    assert.ok(css.includes(`[data-theme="${theme}"]`) || theme === "dark-red", `styles.css defines ${theme}`);
  }
});
