// Registers the offline service worker (see sw.js). Registration failures never affect the page.
(() => {
  "use strict";

  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return;
  }

  navigator.serviceWorker.register("sw.js").catch(error => {
    console.warn("Offline support is unavailable.", error);
  });
})();
