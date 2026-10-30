const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const read = filename => readFileSync(path.join(__dirname, "..", filename), "utf8");
const PAGES = ["index.html", "track.html", "plan.html", "trends.html"];
const SHELL_ASSET = "https://site.test/fitness/app.js";

test("every fitness page links the manifest, icons and the service worker registration", () => {
  for (const page of PAGES) {
    const markup = read(page);

    assert.match(markup, /<link rel="manifest" href="manifest\.webmanifest">/, page);
    assert.match(markup, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/, page);
    assert.match(markup, /<meta name="theme-color" content="#[0-9a-fA-F]{6}">/, page);
    assert.match(markup, /<script src="pwa\.js" defer><\/script>/, page);
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

    for (const script of read(page).matchAll(/<script src="([^"]+)"/g)) {
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

test("service worker caches only app shell files, so other responses never accumulate", async () => {
  const worker = createWorker();
  await worker.request("https://site.test/fitness/routines-backup.json");
  await worker.request(`${SHELL_ASSET}?v=7`);

  assert.deepEqual([...worker.store.keys()], [SHELL_ASSET]);
});

test("service worker revalidates with the network and does not take over pages mid-session", () => {
  const worker = read("sw.js");

  assert.match(worker, /cache: "no-cache"/);
  assert.doesNotMatch(worker, /skipWaiting|clients\.claim/);
  assert.match(worker, /CACHE_VERSION = \d+/);
});

test("every page restricts what it can load with a Content-Security-Policy", () => {
  for (const page of PAGES) {
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read(page))?.[1];

    assert.ok(policy, `${page} has a policy`);
    assert.match(policy, /default-src 'self'/);
    assert.match(policy, /script-src 'self' https:\/\/accounts\.google\.com(;|$)/);
    assert.match(policy, /object-src 'none'/);
    assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline/);
  }
});

test("the manifest has an id, a maskable icon and page shortcuts", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));

  assert.ok(manifest.id);
  assert.ok(manifest.icons.some(icon => icon.purpose === "maskable"));
  assert.ok(manifest.shortcuts.length >= 3);

  for (const shortcut of manifest.shortcuts) {
    assert.ok(PAGES.includes(shortcut.url === "./" ? "index.html" : shortcut.url), shortcut.url);
  }
});

test("the offline banner appears offline, counts only the signed-in account's sets and hides when online", () => {
  const listeners = {};
  const banner = { hidden: true, textContent: "", setAttribute() {} };
  const navigator = { onLine: false };
  const window = {
    WorkoutAuth: { user: { email: "a@example.com" } },
    addEventListener: (name, callback) => { listeners[name] = callback; }
  };
  runInNewContext(read("connectivity.js"), {
    window, navigator,
    document: {
      createElement: () => banner,
      addEventListener: (name, callback) => { listeners[name] = callback; },
      body: { prepend() {} }
    },
    localStorage: { getItem: () => JSON.stringify([{ email: "a@example.com" }, { email: "b@example.com" }, { email: "a@example.com" }]) }
  });
  listeners.DOMContentLoaded();

  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /You are offline.*2 sets are waiting to be sent/);

  navigator.onLine = true;
  window.WorkoutConnectivity.refresh();
  assert.equal(banner.hidden, true);
  assert.equal(banner.textContent, "");
});
