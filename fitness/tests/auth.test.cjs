const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const SOURCE = readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
const { settle } = require("./helpers.cjs");
const user = email => ({ email, name: email, picture: "", expiresAt: Date.now() + 3600000 });
const cachedToken = (email = "current@example.com", token = "cached-token") => ({
  email, token, expiresAt: Date.now() + 3600000
});

function createEnvironment(options = {}) {
  const storage = options.storage || new Map();
  const elements = new Map();
  const scripts = [];
  const timers = new Map();
  const requests = [];
  const errors = [];
  const signIns = [];
  const signOuts = [];
  const removedKeys = [];
  const controls = { failWrite: false, failRemove: false };
  let identityOptions;
  let autoSelectDisabled = 0;
  const createElement = () => ({
    events: {}, textContent: "", hidden: false,
    addEventListener(name, callback) { this.events[name] = callback; }
  });
  const element = selector => {
    if (!elements.has(selector)) {
      elements.set(selector, createElement());
    }

    return elements.get(selector);
  };
  const google = {
    accounts: {
      id: {
        initialize(value) { identityOptions = value; },
        renderButton(target) { assert.equal(target, element("#google-signin-button")); },
        prompt() {},
        disableAutoSelect() { autoSelectDisabled += 1; }
      },
      oauth2: {
        hasGrantedAllScopes: response => options.grantScopes !== false,
        initTokenClient(configuration) {
          return {
            requestAccessToken(requestOptions) { requests.push({ configuration, requestOptions }); }
          };
        }
      }
    }
  };
  const context = {
    WORKOUT_CONFIG: { googleClientId: "test-client", allowedEmails: options.allowedEmails || [] },
    document: {
      querySelector: element,
      createElement,
      head: { append: script => scripts.push(script) }
    },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (controls.failWrite) {
          throw new Error("Session storage unavailable");
        }

        storage.set(key, value);
      },
      removeItem(key) {
        removedKeys.push(key);

        if (controls.failRemove === true || controls.failRemove === key) {
          throw new Error("Session storage unavailable");
        }

        storage.delete(key);
      }
    },
    console: { error: (...messages) => errors.push(messages) },
    setTimeout(callback) {
      const identifier = timers.size + 1;
      timers.set(identifier, callback);

      return identifier;
    },
    clearTimeout: identifier => timers.delete(identifier),
    atob, TextDecoder, Uint8Array
  };
  context.window = context;

  if (!options.deferLibrary) {
    context.google = google;
  }

  runInNewContext(SOURCE, context);

  function signIn(email = "current@example.com", overrides = {}) {
    const payload = {
      iss: "https://accounts.google.com", aud: "test-client",
      email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides
    };
    context.handleCredentialResponse({ credential: `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature` });
  }

  return {
    context, storage, scripts, timers, requests, errors, controls, element, signIns, signOuts, removedKeys, signIn,
    auth: context.WorkoutAuth,
    init() { context.WorkoutAuth.init({ onSignIn: value => signIns.push(value), onSignOut: () => signOuts.push(true) }); },
    loadLibrary() { context.google = google; scripts[0].events.load(); },
    respond(response = { access_token: "new-token" }, index = requests.length - 1) {
      requests[index].configuration.callback(response);
    },
    get identityOptions() { return identityOptions; },
    get autoSelectDisabled() { return autoSelectDisabled; }
  };
}

test("loads Google Identity once and initializes sign-in when the asynchronous script is ready", async () => {
  const environment = createEnvironment({ deferLibrary: true });
  environment.init();
  environment.signIn();
  const token = environment.auth.getFormsAccessToken();
  assert.equal(environment.scripts.length, 1);
  assert.equal(environment.scripts[0].src, "https://accounts.google.com/gsi/client");
  assert.equal(environment.identityOptions, undefined);
  environment.loadLibrary();
  await settle();
  assert.equal(environment.identityOptions.client_id, "test-client");
  assert.equal(environment.requests.length, 1);
  assert.equal(environment.requests[0].configuration.hint, "current@example.com");
  assert.equal(environment.requests[0].configuration.scope,
    "https://www.googleapis.com/auth/forms.body.readonly https://www.googleapis.com/auth/forms.responses.readonly");
  assert.equal(environment.requests[0].requestOptions.prompt, "");
  environment.respond();
  assert.equal(await token, "new-token");
  assert.equal(environment.timers.size, 0);
});

test("reports Google Identity script errors and timeouts on the login view", async () => {
  for (const failure of ["error", "timeout"]) {
    const environment = createEnvironment({ deferLibrary: true });
    environment.init();

    if (failure === "error") {
      environment.scripts[0].events.error();
    } else {
      [...environment.timers.values()][0]();
    }

    await settle();
    assert.match(environment.element("#login-error").textContent, /Google sign-in library/);
    assert.equal(environment.errors.length, 1);
  }
});

test("all fitness pages let the shared auth module load Google Identity", () => {
  for (const filename of ["index.html", "track.html", "trends.html"]) {
    const markup = readFileSync(path.join(__dirname, "..", filename), "utf8");
    assert.match(markup, /<script src="auth\.js" defer><\/script>/);
    assert.doesNotMatch(markup, /src="https:\/\/accounts\.google\.com\/gsi\/client"/);
  }
});

test("restores the existing signed-in session and migrates a legacy Forms token without consent", async () => {
  const savedToken = cachedToken();
  const storage = new Map([
    ["workout.user", JSON.stringify(user("current@example.com"))],
    ["workout.trendsToken", JSON.stringify(savedToken)]
  ]);
  const environment = createEnvironment({ storage });
  environment.init();
  assert.equal(environment.signIns.length, 1);
  assert.equal(environment.auth.hasCachedToken(), true);
  assert.equal(await environment.auth.getFormsAccessToken(), "cached-token");
  assert.equal(environment.requests.length, 0);
  assert.equal(storage.has("workout.trendsToken"), false);
  assert.deepEqual(JSON.parse(storage.get("workout.formsToken")), savedToken);
});

test("sign-in decodes Unicode names and keeps the existing session shape", () => {
  const environment = createEnvironment();
  environment.init();
  environment.signIn("current@example.com", { name: "Zo\u00eb", picture: "https://example.test/avatar" });
  assert.equal(environment.auth.user.name, "Zo\u00eb");
  assert.equal(environment.element("#user-avatar").src, "https://example.test/avatar");
  assert.equal(environment.element("#login-view").hidden, true);
  assert.deepEqual(Object.keys(JSON.parse(environment.storage.get("workout.user"))).sort(),
    ["email", "expiresAt", "name", "picture"]);
});

test("rejects malformed, expired, wrong-audience and disallowed sign-in credentials", () => {
  for (const overrides of [
    { iss: "https://example.test" }, { aud: "other-client" },
    { email_verified: false }, { email_verified: undefined }, { exp: 1 }, { email: "other@example.com" }
  ]) {
    const environment = createEnvironment({ allowedEmails: ["current@example.com"] });
    environment.init();
    environment.signIn("current@example.com", overrides);
    assert.equal(environment.auth.user, null);
    assert.ok(environment.element("#login-error").textContent);
    assert.equal(environment.storage.has("workout.user"), false);
  }

  const environment = createEnvironment();
  environment.context.handleCredentialResponse({ credential: "invalid" });
  assert.match(environment.element("#login-error").textContent, /Could not read/);
});

test("expired, malformed and different-account caches request a fresh token", async () => {
  for (const saved of [
    "{invalid",
    JSON.stringify({ ...cachedToken(), expiresAt: Date.now() + 30000 }),
    JSON.stringify(cachedToken("other@example.com")),
    JSON.stringify({ ...cachedToken(), token: "" })
  ]) {
    const environment = createEnvironment({ storage: new Map([["workout.formsToken", saved]]) });
    environment.signIn();
    const token = environment.auth.getFormsAccessToken();
    await settle();
    environment.respond();
    assert.equal(await token, "new-token");
    const stored = JSON.parse(environment.storage.get("workout.formsToken"));
    assert.equal(stored.email, "current@example.com");
    assert.equal(stored.token, "new-token");
    assert.ok(stored.expiresAt > Date.now() + 54 * 60000);
  }
});

test("invalid Forms token cache entries are cleared before requesting a fresh token", () => {
  for (const saved of [
    "{invalid",
    JSON.stringify({ ...cachedToken(), expiresAt: Date.now() + 30000 }),
    JSON.stringify(cachedToken("other@example.com")),
    JSON.stringify({ ...cachedToken(), token: "" })
  ]) {
    const storage = new Map([["workout.formsToken", saved]]);
    const environment = createEnvironment({ storage });
    environment.signIn();
    assert.equal(environment.auth.hasCachedToken(), false);
    assert.equal(storage.has("workout.formsToken"), false);
    assert.equal(storage.has("workout.trendsToken"), false);
  }
});

test("concurrent Forms reads share a token request and forced renewal bypasses cached tokens", async () => {
  const environment = createEnvironment();
  environment.signIn();
  const first = environment.auth.getFormsAccessToken();
  const second = environment.auth.getFormsAccessToken();
  await settle();
  assert.equal(environment.requests.length, 1);
  environment.respond();
  assert.deepEqual(await Promise.all([first, second]), ["new-token", "new-token"]);
  const renewal = environment.auth.getFormsAccessToken({ forceNew: true });
  await settle();
  assert.equal(environment.requests.length, 2);
  environment.respond({ access_token: "renewed-token" });
  assert.equal(await renewal, "renewed-token");
});

test("permission denial, popup errors and missing tokens reject explicitly without caching", async () => {
  for (const failure of ["denied", "scopes", "popup", "missing-token"]) {
    const environment = createEnvironment({ grantScopes: failure !== "scopes" });
    environment.signIn();
    const token = environment.auth.getFormsAccessToken();
    const rejected = assert.rejects(token, error => {
      assert.ok(error.message);

      if (failure !== "missing-token") {
        assert.ok(error.code);
      }

      return true;
    });
    await settle();

    if (failure === "popup") {
      environment.requests[0].configuration.error_callback({ type: "popup_closed", message: "Window closed" });
    } else {
      environment.respond(failure === "denied" ? { error: "access_denied" } :
        failure === "missing-token" ? {} : { access_token: "token" });
    }

    await rejected;
    assert.equal(environment.storage.has("workout.formsToken"), false);
  }
});

test("sign-out clears both token keys and rejects an in-flight token for the previous session", async () => {
  const environment = createEnvironment();
  environment.signIn();
  const token = environment.auth.getFormsAccessToken();
  const rejected = assert.rejects(token, /account changed/);
  await settle();
  environment.storage.set("workout.trendsToken", JSON.stringify(cachedToken()));
  environment.auth.signOut();
  assert.equal(environment.auth.user, null);
  assert.equal(environment.storage.has("workout.user"), false);
  assert.equal(environment.storage.has("workout.trendsToken"), false);
  assert.equal(environment.autoSelectDisabled, 1);
  environment.signIn();
  environment.respond();
  await rejected;
  assert.equal(environment.storage.has("workout.formsToken"), false);
});

test("missing Forms access requests a new token again after a successful read", async () => {
  const environment = createEnvironment();
  environment.signIn();
  const firstTokenRequest = environment.auth.getFormsAccessToken();
  await settle();
  environment.respond();
  assert.equal(await firstTokenRequest, "new-token");
  assert.equal(await environment.auth.getFormsAccessToken(), "new-token");

  environment.auth.clearCachedToken();
  const renewedToken = environment.auth.getFormsAccessToken();
  await settle();
  assert.equal(environment.requests.length, 2);
  environment.respond({ access_token: "renewed-token" }, 1);
  assert.equal(await renewedToken, "renewed-token");
});

test("account switching invalidates cached and in-flight tokens without replacing the new account's cache", async () => {
  const environment = createEnvironment();
  environment.signIn();
  const first = environment.auth.getFormsAccessToken();
  const rejected = assert.rejects(first, /account changed/);
  await settle();
  environment.signIn("other@example.com");
  const second = environment.auth.getFormsAccessToken();
  await settle();
  environment.respond({ access_token: "other-token" }, 1);
  assert.equal(await second, "other-token");
  environment.respond({ access_token: "stale-token" }, 0);
  await rejected;
  assert.equal(JSON.parse(environment.storage.get("workout.formsToken")).email, "other@example.com");
  assert.equal(JSON.parse(environment.storage.get("workout.formsToken")).token, "other-token");
});

test("a session storage write failure rejects token acquisition rather than claiming persistence", async () => {
  const environment = createEnvironment();
  environment.signIn();
  const token = environment.auth.getFormsAccessToken();
  const rejected = assert.rejects(token, /Session storage unavailable/);
  await settle();
  environment.controls.failWrite = true;
  environment.respond();
  await rejected;
  assert.equal(environment.storage.has("workout.formsToken"), false);
});

test("blocked session storage cannot prevent sign-out or leave an in-flight token active", async () => {
  for (const failedKey of [true, "workout.user", "workout.formsToken", "workout.trendsToken"]) {
    const environment = createEnvironment();
    environment.init();
    environment.signIn();
    const token = environment.auth.getFormsAccessToken();
    const rejected = assert.rejects(token, /account changed/);
    await settle();
    environment.storage.set("workout.formsToken", JSON.stringify(cachedToken()));
    environment.storage.set("workout.trendsToken", JSON.stringify(cachedToken()));
    environment.controls.failRemove = failedKey;
    environment.removedKeys.length = 0;
    assert.doesNotThrow(() => environment.auth.signOut());
    assert.equal(environment.auth.user, null);
    assert.equal(environment.element("#login-view").hidden, false);
    assert.equal(environment.element("#user-box").hidden, true);
    assert.equal(environment.signOuts.length, 1);
    assert.equal(environment.autoSelectDisabled, 1);
    assert.deepEqual(environment.removedKeys, ["workout.user", "workout.formsToken", "workout.trendsToken"]);
    assert.match(environment.element("#login-error").textContent, /Close this tab/);
    assert.equal(environment.errors.length, failedKey === true ? 3 : 1);
    environment.respond();
    await rejected;
    await assert.rejects(environment.auth.getFormsAccessToken(), /Sign in/);
  }
});
