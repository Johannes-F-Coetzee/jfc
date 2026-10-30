const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const read = filename => readFileSync(path.join(__dirname, "..", filename), "utf8");
const PAGES = ["index.html", "track.html", "plan.html", "trends.html"];

test("every fitness page links the manifest, icons and the service worker registration", () => {
  for (const page of PAGES) {
    const markup = read(page);

    assert.match(markup, /<link rel="manifest" href="manifest\.webmanifest">/, page);
    assert.match(markup, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/, page);
    assert.match(markup, /<meta name="theme-color" content="#[0-9a-fA-F]{6}">/, page);
    assert.match(markup, /versionedScript\("pwa\.js", true\)/, page);
  }
});

test("the manifest is installable and its icons exist", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512"));

  for (const icon of manifest.icons) {
    assert.ok(existsSync(path.join(__dirname, "..", icon.src)), icon.src);
  }
});

test("the service worker precaches every page and script the pages load", () => {
  const worker = read("sw.js");
  const precached = new Set([...(/APP_SHELL = \[([\s\S]*?)\];/.exec(worker)[1].matchAll(/"([^"]+)"/g))]
    .map(match => match[1]));

  for (const page of PAGES) {
    assert.ok(precached.has(page), `${page} is precached`);

    for (const script of read(page).matchAll(/versionedScript\("([^"]+)"/g)) {
      assert.ok(precached.has(script[1]), `${script[1]} (${page}) is precached`);
    }
  }

  for (const asset of precached) {
    assert.ok(asset === "./" || existsSync(path.join(__dirname, "..", asset)), `${asset} exists`);
  }
});

test("the service worker only handles same-origin GET requests", () => {
  const worker = read("sw.js");

  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /\.origin !== self\.location\.origin/);
});

function createWorker({ online = true } = {}) {
  const listeners = {};
  const store = new Map();
  const fetched = [];
  const cache = {
    put: async (key, response) => { store.set(key, response); },
    addAll: async requests => { requests.forEach(request => store.set(new URL(request.url, "https://site.test/fitness/").href, { precached: true })); }
  };
  const self = {
    location: new URL("https://site.test/fitness/sw.js"),
    addEventListener: (name, callback) => { listeners[name] = callback; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };
  runInNewContext(read("sw.js"), {
    self, URL, Request: class { constructor(url) { this.url = url; } },
    caches: {
      open: async () => cache,
      match: async key => store.get(key),
      keys: async () => [],
      delete: async () => true
    },
    fetch: async request => {
      fetched.push(request.url);

      if (!online) {
        throw new Error("offline");
      }

      return { ok: true, clone() { return this; }, body: request.url };
    }
  });

  return {
    store, fetched,
    async request(url, { method = "GET", mode = "cors" } = {}) {
      let response;
      const event = { request: { url, method, mode }, respondWith: promise => { response = promise; } };
      listeners.fetch(event);

      return response === undefined ? undefined : response;
    }
  };
}

test("service worker serves the network response and caches it without the version query", async () => {
  const worker = createWorker();
  const response = await worker.request("https://site.test/fitness/app.js?v=123");

  assert.equal(response.body, "https://site.test/fitness/app.js?v=123");
  assert.ok(worker.store.has("https://site.test/fitness/app.js"));
  assert.equal(worker.store.size, 1);
});

test("service worker falls back to the cached copy, then to the cached Log page, when offline", async () => {
  const worker = createWorker({ online: false });
  worker.store.set("https://site.test/fitness/app.js", { cached: "app" });
  worker.store.set("https://site.test/fitness/index.html", { cached: "log" });

  assert.deepEqual(await worker.request("https://site.test/fitness/app.js?v=9"), { cached: "app" });
  assert.deepEqual(await worker.request("https://site.test/fitness/uncached.html", { mode: "navigate" }), { cached: "log" });
  await assert.rejects(worker.request("https://site.test/fitness/uncached.js"), /offline/);
});

test("service worker ignores cross-origin and non-GET requests", async () => {
  const worker = createWorker();

  assert.equal(await worker.request("https://forms.googleapis.com/v1/forms/x"), undefined);
  assert.equal(await worker.request("https://docs.google.com/forms/d/e/x/formResponse", { method: "POST" }), undefined);
  assert.equal(await worker.request("https://site.test/fitness/app.js", { method: "POST" }), undefined);
  assert.equal(worker.fetched.length, 0);
});
