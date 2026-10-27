// Shared Google sign-in for the workout pages. Pages provide the elements:
// #login-view, #google-signin-button, #login-error, #user-box, #user-avatar, #user-name, #sign-out.
(() => {
  "use strict";

  const CONFIG = window.WORKOUT_CONFIG || {};
  const USER_KEY = "workout.user";
  const SESSION_HOURS = 12;
  const $ = sel => document.querySelector(sel);

  let currentUser = null;
  let googleInitialized = false;
  let handlers = { onSignIn() { }, onSignOut() { } };

  function hasClientId() {
    return typeof CONFIG.googleClientId === "string" && CONFIG.googleClientId.trim() !== "";
  }

  function decodeJwt(token) {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function isAllowed(email) {
    const list = (CONFIG.allowedEmails || []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
    return list.length === 0 || list.includes(email.toLowerCase());
  }

  function showLoginError(message) {
    const el = $("#login-error");
    if (el) el.textContent = message;
  }

  function showSignedIn(user) {
    currentUser = user;
    $("#login-view").hidden = true;
    $("#user-box").hidden = false;
    $("#user-name").textContent = user.name;
    const avatar = $("#user-avatar");
    avatar.hidden = !user.picture;
    if (user.picture) avatar.src = user.picture;
    handlers.onSignIn(user);
  }

  // Global so it can also be used as a GIS HTML-API data-callback.
  window.handleCredentialResponse = function (response) {
    let payload;
    try {
      payload = decodeJwt(response.credential);
    } catch {
      showLoginError("Could not read the Google sign-in response.");
      return;
    }
    const issuerOk = payload.iss === "accounts.google.com" || payload.iss === "https://accounts.google.com";
    if (!issuerOk || payload.aud !== CONFIG.googleClientId) {
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
      if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
      return;
    }
    const user = {
      email: payload.email,
      name: payload.name || payload.email,
      picture: payload.picture || "",
      expiresAt: Date.now() + SESSION_HOURS * 3600 * 1000
    };
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    showLoginError("");
    showSignedIn(user);
  };

  function restoreUser() {
    try {
      const user = JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
      if (user && user.expiresAt > Date.now() && isAllowed(user.email)) return user;
    } catch { /* fall through */ }
    sessionStorage.removeItem(USER_KEY);
    return null;
  }

  function initGoogle() {
    if (googleInitialized || !hasClientId() || !window.google?.accounts?.id) return;
    googleInitialized = true;
    google.accounts.id.initialize({
      client_id: CONFIG.googleClientId,
      callback: window.handleCredentialResponse,
      auto_select: true,
      cancel_on_tap_outside: true
    });
    google.accounts.id.renderButton($("#google-signin-button"), {
      theme: "filled_blue", size: "large", shape: "pill", text: "signin_with"
    });
    if (!currentUser) google.accounts.id.prompt();
  }

  function signOut() {
    sessionStorage.removeItem(USER_KEY);
    currentUser = null;
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    $("#user-box").hidden = true;
    $("#login-view").hidden = false;
    handlers.onSignOut();
  }

  // Requests an OAuth access token for the signed-in user. Must be called from a user gesture
  // the first time, because Google may open a consent popup.
  function requestAccessToken(scopes) {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) {
        reject(new Error("Google sign-in library has not loaded yet."));
        return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.googleClientId,
        scope: scopes.join(" "),
        hint: currentUser?.email,
        callback: resp => {
          if (resp.error) reject(Object.assign(new Error(resp.error_description || resp.error), { code: resp.error }));
          else if (!scopes.every(s => google.accounts.oauth2.hasGrantedAllScopes(resp, s))) {
            reject(Object.assign(new Error("Not all requested permissions were granted."), { code: "access_denied" }));
          } else resolve(resp.access_token);
        },
        error_callback: err => reject(Object.assign(new Error(err.message || err.type), { code: err.type }))
      });
      client.requestAccessToken({ prompt: "" });
    });
  }

  function init(pageHandlers) {
    handlers = { ...handlers, ...pageHandlers };
    $("#sign-out").addEventListener("click", signOut);
    const user = restoreUser();
    if (user) showSignedIn(user);
    if (window.google?.accounts?.id) initGoogle();
    else window.onGoogleLibraryLoad = initGoogle;
  }

  window.WorkoutAuth = {
    init,
    signOut,
    requestAccessToken,
    hasClientId,
    get user() { return currentUser; }
  };
})();
