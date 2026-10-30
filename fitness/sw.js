// Offline support for the fitness pages. Same-origin GETs are network-first (revalidating the browser's HTTP
// cache), so a deploy is picked up as soon as the device is online; the last good copy is served when it is not.
// Only the app shell is cached, so unrelated files never accumulate. Google APIs, the Google Identity script
// and form submissions are cross-origin or non-GET and are never intercepted, so the existing draft saving and
// retry queue keep working unchanged. Bump CACHE_VERSION whenever APP_SHELL changes.
"use strict";

const CACHE_VERSION = 3;
const CACHE_NAME = `fitness-shell-v${CACHE_VERSION}`;
const APP_SHELL = [
  "./", "index.html", "track.html", "plan.html", "trends.html", "styles.css", "manifest.webmanifest",
  "exercise_favicon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png", "config.js", "settings.js", "shared-header.js", "utilities.js", "auth.js",
  "google-forms.js", "submission-status.js", "connectivity.js", "routines.js", "plans.js", "plan-schedule.js",
  "logged-workouts.js", "workout-suggestions.js", "pwa.js", "app.js", "track.js", "plan.js", "trends.js"
];

// Cache keys ignore any query string so a cache-busting parameter never stores a second copy.
function cacheKey(url) {
  const key = new URL(url);
  key.search = "";
  key.hash = "";

  return key.href;
}

const SHELL_KEYS = new Set(APP_SHELL.map(path => cacheKey(new URL(path, self.location.href))));

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL.map(path => new Request(path, { cache: "reload" }))))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))))
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;

  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith((async () => {
    const key = cacheKey(request.url);

    try {
      const response = await fetch(request, { cache: "no-cache" });

      if (response.ok && SHELL_KEYS.has(key)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(key, response.clone());
      }

      return response;
    } catch (error) {
      const cached = await caches.match(key);

      if (cached) {
        return cached;
      }

      if (request.mode === "navigate") {
        const fallback = await caches.match(cacheKey(new URL("index.html", self.location.href)));

        if (fallback) {
          return fallback;
        }
      }

      throw error;
    }
  })());
});
