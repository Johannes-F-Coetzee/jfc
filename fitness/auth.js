// Shared Google sign-in for the workout pages. Pages provide the elements:
// #login-view, #google-signin-button, #login-error, #user-box, #user-avatar, #user-name, #sign-out.
(() => {
  "use strict";

  const WORKOUT_CONFIGURATION = window.WORKOUT_CONFIG || {};
  const SESSION_USER_STORAGE_KEY = "workout.user";
  const SESSION_ACCESS_TOKEN_KEY = "workout.formsToken";
  const LEGACY_SESSION_ACCESS_TOKEN_KEY = "workout.trendsToken";
  const FORMS_READ_PERMISSIONS = [
    "https://www.googleapis.com/auth/forms.body.readonly",
    "https://www.googleapis.com/auth/forms.responses.readonly"
  ];
  const SESSION_DURATION_HOURS = 12;
  const OAUTH_LIBRARY_WAIT_MILLISECONDS = 10000;
  const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client";
  const $ = selector => document.querySelector(selector);

  let currentUser = null;
  let googleIdentityInitialized = false;
  let googleLibraryPromise = null;
  let tokenRequest = null;
  let sessionVersion = 0;
  let handlers = { onSignIn() {}, onSignOut() {} };

  function hasConfiguredGoogleClientIdentifier() {
    return typeof WORKOUT_CONFIGURATION.googleClientId === "string" &&
      WORKOUT_CONFIGURATION.googleClientId.trim() !== "";
  }

  function decodeCredentialPayload(credentialToken) {
    const encodedPayload = credentialToken.split(".")[1];
    const base64Payload = encodedPayload.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const payloadBytes = Uint8Array.from(atob(base64Payload), byte => byte.charCodeAt(0));

    return JSON.parse(new TextDecoder().decode(payloadBytes));
  }

  function isAllowed(email) {
    const allowedEmailAddresses = (WORKOUT_CONFIGURATION.allowedEmails || [])
      .map(allowedEmail => String(allowedEmail).trim().toLowerCase())
      .filter(Boolean);

    return allowedEmailAddresses.length === 0 || allowedEmailAddresses.includes(email.toLowerCase());
  }

  function showLoginError(message) {
    const element = $("#login-error");

    if (element) {
      element.textContent = message;
    }
  }

  function showSignedIn(user) {
    if (currentUser && currentUser.email !== user.email) {
      clearCachedToken();
      sessionVersion += 1;
    }

    currentUser = user;
    $("#login-view").hidden = true;
    $("#user-box").hidden = false;
    $("#user-name").textContent = user.name;
    const avatar = $("#user-avatar");
    avatar.hidden = !user.picture;

    if (user.picture) {
      avatar.src = user.picture;
    }

    handlers.onSignIn(user);
  }

  // Global so Google's sign-in data callback can use it.
  window.handleCredentialResponse = function (response) {
    let payload;

    try {
      payload = decodeCredentialPayload(response.credential);
    } catch {
      showLoginError("Could not read the Google sign-in response.");

      return;
    }

    const issuerIsValid = payload.iss === "accounts.google.com" ||
      payload.iss === "https://accounts.google.com";

    if (!issuerIsValid || payload.aud !== WORKOUT_CONFIGURATION.googleClientId) {
      showLoginError("Sign-in response was not issued for this site.");

      return;
    }

    if (!payload.email || payload.email_verified === false) {
      showLoginError("Your Google account email is not verified.");

      return;
    }

    if (payload.exp * 1000 < Date.now()) {
      showLoginError("Sign-in expired, please try again.");

      return;
    }

    if (!isAllowed(payload.email)) {
      showLoginError(`${payload.email} is not authorised to use this tracker.`);

      if (window.google?.accounts?.id) {
        google.accounts.id.disableAutoSelect();
      }

      return;
    }

    const user = {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || "",
      expiresAt: Date.now() + SESSION_DURATION_HOURS * 3600 * 1000
    };
    sessionStorage.setItem(SESSION_USER_STORAGE_KEY, JSON.stringify(user));
    showLoginError("");
    showSignedIn(user);
  };

  function restoreUser() {
    try {
      const user = JSON.parse(sessionStorage.getItem(SESSION_USER_STORAGE_KEY) || "null");

      if (user && user.expiresAt > Date.now() && isAllowed(user.email)) {
        return user;
      }
    } catch (error) {
      console.error("Could not restore Google sign-in.", error);
      showLoginError("Saved sign-in could not be restored. Please sign in again.");
    }

    sessionStorage.removeItem(SESSION_USER_STORAGE_KEY);

    return null;
  }

  function initGoogle() {
    if (googleIdentityInitialized || !hasConfiguredGoogleClientIdentifier() || !window.google?.accounts?.id) {
      return;
    }

    googleIdentityInitialized = true;
    google.accounts.id.initialize({
      client_id: WORKOUT_CONFIGURATION.googleClientId,
      callback: window.handleCredentialResponse,
      auto_select: true,
      cancel_on_tap_outside: true
    });
    google.accounts.id.renderButton($("#google-signin-button"), {
      theme: "filled_blue",
      size: "large",
      shape: "pill",
      text: "signin_with"
    });

    if (!currentUser) {
      google.accounts.id.prompt();
    }
  }

  function signOut() {
    currentUser = null;
    sessionVersion += 1;
    let storageCleanupFailed = false;

    for (const key of [SESSION_USER_STORAGE_KEY, SESSION_ACCESS_TOKEN_KEY, LEGACY_SESSION_ACCESS_TOKEN_KEY]) {
      try {
        sessionStorage.removeItem(key);
      } catch (error) {
        storageCleanupFailed = true;
        console.error("Could not remove saved Google session data.", error);
      }
    }

    if (window.google?.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }

    $("#user-box").hidden = true;
    $("#login-view").hidden = false;
    handlers.onSignOut();
    showLoginError(storageCleanupFailed
      ? "Signed out of this page, but saved sign-in data could not be cleared. Close this tab to end the saved session."
      : "");
  }

  function loadGoogleLibrary() {
    if (window.google?.accounts?.id && window.google?.accounts?.oauth2) {
      return Promise.resolve();
    }

    if (!googleLibraryPromise) {
      googleLibraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = GOOGLE_IDENTITY_SCRIPT_URL;
        script.async = true;
        const timeout = setTimeout(() => {
          reject(new Error("Google sign-in library has not loaded yet. Reload the page to try again."));
        }, OAUTH_LIBRARY_WAIT_MILLISECONDS);
        script.addEventListener("load", () => {
          clearTimeout(timeout);

          if (!window.google?.accounts?.id || !window.google?.accounts?.oauth2) {
            reject(new Error("Google sign-in library could not be initialized."));

            return;
          }

          resolve();
        });
        script.addEventListener("error", () => {
          clearTimeout(timeout);
          reject(new Error("Google sign-in library could not be loaded. Check your connection and reload the page."));
        });
        document.head.append(script);
      });
    }

    return googleLibraryPromise;
  }

  // Requests an OAuth access token for the signed-in user. Must be called from a user gesture
  // the first time, because Google may open a consent popup.
  async function requestAccessToken(scopes) {
    if (!hasConfiguredGoogleClientIdentifier()) {
      throw new Error("Google sign-in is not configured for this site.");
    }

    await loadGoogleLibrary();

    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: WORKOUT_CONFIGURATION.googleClientId,
        scope: scopes.join(" "),
        hint: currentUser?.email,
        callback: response => {
          if (response.error) {
            reject(Object.assign(
              new Error(response.error_description || response.error),
              { code: response.error }
            ));
          } else if (!scopes.every(scope => google.accounts.oauth2.hasGrantedAllScopes(response, scope))) {
            reject(Object.assign(
              new Error("Not all requested permissions were granted."),
              { code: "access_denied" }
            ));
          } else if (typeof response.access_token !== "string" || !response.access_token) {
            reject(new Error("Google did not return an access token."));
          } else {
            resolve(response.access_token);
          }
        },
        error_callback: error => reject(Object.assign(
          new Error(error.message || error.type),
          { code: error.type }
        ))
      });
      client.requestAccessToken({ prompt: "" });
    });
  }

  function clearCachedToken() {
    sessionStorage.removeItem(SESSION_ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);
  }

  function readCachedToken() {
    let cachedAccessToken;

    try {
      cachedAccessToken = JSON.parse(
        sessionStorage.getItem(SESSION_ACCESS_TOKEN_KEY) ||
        sessionStorage.getItem(LEGACY_SESSION_ACCESS_TOKEN_KEY) ||
        "null"
      );
    } catch (error) {
      console.error("Could not read the cached Google Forms access token.", error);
      clearCachedToken();

      return null;
    }

    if (typeof cachedAccessToken?.token !== "string" || !cachedAccessToken.token ||
      cachedAccessToken.email !== currentUser?.email ||
      cachedAccessToken.expiresAt <= Date.now() + 60000 ||
      !Number.isFinite(cachedAccessToken.expiresAt)) {
      return null;
    }

    return cachedAccessToken;
  }

  function hasCachedToken() {
    return Boolean(readCachedToken());
  }

  async function getFormsAccessToken({ forceNew = false } = {}) {
    if (!currentUser) {
      throw new Error("Sign in before reading Google Forms data.");
    }

    if (forceNew) {
      clearCachedToken();
    } else {
      const cachedAccessToken = readCachedToken();

      if (cachedAccessToken) {
        sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, JSON.stringify(cachedAccessToken));
        sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);

        return cachedAccessToken.token;
      }
    }

    const ownerEmail = currentUser.email;
    const ownerVersion = sessionVersion;

    if (tokenRequest?.email === ownerEmail && tokenRequest.version === ownerVersion) {
      return tokenRequest.promise;
    }

    const request = {
      email: ownerEmail,
      version: ownerVersion,
      promise: (async () => {
        const token = await requestAccessToken(FORMS_READ_PERMISSIONS);

        if (currentUser?.email !== ownerEmail || sessionVersion !== ownerVersion) {
          throw new Error("The signed-in account changed.");
        }

        sessionStorage.setItem(SESSION_ACCESS_TOKEN_KEY, JSON.stringify({
          token,
          email: ownerEmail,
          expiresAt: Date.now() + 55 * 60000
        }));
        sessionStorage.removeItem(LEGACY_SESSION_ACCESS_TOKEN_KEY);

        return token;
      })()
    };
    tokenRequest = request;

    try {
      return await request.promise;
    } finally {
      if (tokenRequest === request) {
        tokenRequest = null;
      }
    }
  }

  function init(pageHandlers) {
    handlers = { ...handlers, ...pageHandlers };
    $("#sign-out").addEventListener("click", signOut);
    const user = restoreUser();

    if (user) {
      showSignedIn(user);
    }

    if (!hasConfiguredGoogleClientIdentifier()) {
      showLoginError("Google sign-in is not configured for this site.");

      return;
    }

    loadGoogleLibrary().then(initGoogle).catch(error => {
      console.error("Could not initialize Google sign-in.", error);
      showLoginError(error.message);
    });
  }

  window.WorkoutAuth = {
    init,
    signOut,
    getFormsAccessToken,
    hasCachedToken,
    clearCachedToken,
    hasConfiguredGoogleClientIdentifier,
    get user() {
      return currentUser;
    }
  };
})();
