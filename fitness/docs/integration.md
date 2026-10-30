# Shared Google integration

How the fitness pages share sign-in and Google Forms access. Back to the [setup guide](../../README.md).

All fitness pages use the same browser-native integration modules:

- [`fitness/auth.js`](../auth.js) loads Google Identity Services, renders sign-in, restores the existing `workout.user` session, and handles sign-out. It also owns Forms read consent and the account-bound `workout.formsToken` cache, migrating the legacy `workout.trendsToken` key. Concurrent token requests share one consent request; after the first successful Forms read, missing, rejected, or expired tokens can trigger another permission popup. Sign-out clears both token keys, and a token returned after an account change is discarded. The two read-only Forms scopes and existing session/token storage shapes are unchanged.
- [`fitness/google-forms.js`](../google-forms.js) provides submission configuration checks, anonymous form POSTs with a 15-second timeout, API errors, question mapping, paginated response reads, and answer decoding. Authenticated reads use the shared token cache. Trends retains its one-time refresh/retry on HTTP 401; routine reads invalidate rejected tokens and leave retrying to the existing routine action.
- Page scripts keep their domain-specific validation, units, history, queues, and status messages. Log and Track still report an opaque POST as sent, not confirmed; routine saves still read back every set before reporting success. Workout form mappings may remain optional, while Track requires all mappings to be present and unique.
- [`fitness/plans.js`](../plans.js) uses the same read/POST helpers for account-filtered plan snapshots, with complete-row validation, name conflict checks, resumable pending saves, and read-back confirmation.

The Fitness HTML pages load their scripts, stylesheet, and favicon with plain tags and no version query; GitHub Pages revalidates them with ETags. Google Forms API reads bypass the HTTP cache; access tokens remain in session storage with expiry checks, while drafts, queues, settings, and histories remain durable device data in their existing storage formats.

Google Identity load failures are shown in the sign-in view. No credentials or access tokens belong in configuration files, exported routines, or commits.

Sign-out clears the active page session even if browser session storage is unavailable. If saved session data cannot be removed, the sign-in view warns you to close the tab to end the saved session.

## Offline support and installing

The fitness pages are installable (`manifest.webmanifest`, icons in `fitness/icons/`) and load offline through the service worker in [`sw.js`](../sw.js), registered by [`pwa.js`](../pwa.js). Registration needs HTTPS or `localhost`.

- Same-origin GET requests are **network-first**: online, the newest files are used and the cache is refreshed; offline, the last good copy is served. Pages fall back to the cached Log page when a URL was never cached.
- The service worker never touches cross-origin requests (Google sign-in, Forms API reads, form POSTs) or non-GET requests, so drafts, the submission queue and retries behave exactly as before. Signing in and reading Forms data still require a connection; a signed-in session restored from session storage lets you keep logging, and queued submissions send once you are back online.
- After adding a page or script, list it in `APP_SHELL` in `sw.js`; `tests/pwa.test.cjs` fails if a page loads something that is not precached. Bump `CACHE_NAME` to drop old caches.
- Charts expose a text alternative (`role="img"` with an `aria-label` giving the metric, date span, latest, lowest and highest values); the data tables below them hold the full values.
