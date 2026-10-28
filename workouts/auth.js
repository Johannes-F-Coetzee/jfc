// Shared Google sign-in for the workout pages. Pages provide the elements:
// #login-view, #google-signin-button, #login-error, #user-box, #user-avatar, #user-name, #sign-out.
(() => {
  "use strict";

  const WORKOUT_CONFIGURATION = window.WORKOUT_CONFIG || {};
  const SESSION_USER_STORAGE_KEY = "workout.user";
  const SESSION_DURATION_HOURS = 12;
  const OAUTH_LIBRARY_WAIT_MILLISECONDS = 10000;
  const $ = selector => document.querySelector(selector);

  let currentUser = null;
  let googleIdentityInitialized = false;
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
    } catch { /* fall through */ }

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
    sessionStorage.removeItem(SESSION_USER_STORAGE_KEY);
    currentUser = null;

    if (window.google?.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }

    $("#user-box").hidden = true;
    $("#login-view").hidden = false;
    handlers.onSignOut();
  }

  function waitForOauthLibrary() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (window.google?.accounts?.oauth2) {
          resolve();

          return;
        }

        if (Date.now() - startedAt >= OAUTH_LIBRARY_WAIT_MILLISECONDS) {
          reject(new Error("Google sign-in library has not loaded yet."));

          return;
        }

        setTimeout(check, 100);
      };
      check();
    });
  }

  // Requests an OAuth access token for the signed-in user. Must be called from a user gesture
  // the first time, because Google may open a consent popup.
  async function requestAccessToken(scopes) {
    await waitForOauthLibrary();

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

  function init(pageHandlers) {
    handlers = { ...handlers, ...pageHandlers };
    $("#sign-out").addEventListener("click", signOut);
    const user = restoreUser();

    if (user) {
      showSignedIn(user);
    }

    if (window.google?.accounts?.id) {
      initGoogle();
    } else {
      window.onGoogleLibraryLoad = initGoogle;
    }
  }

  window.WorkoutAuth = {
    init,
    signOut,
    requestAccessToken,
    hasConfiguredGoogleClientIdentifier,
    get user() {
      return currentUser;
    }
  };
})();
