// Shows a banner while the device is offline, with how many workout sets are waiting to be sent.
(() => {
  "use strict";

  const QUEUE_STORAGE_KEY = "workout.queue";
  const banner = document.createElement("p");
  banner.className = "offline-banner";
  banner.setAttribute("role", "status");
  banner.hidden = true;

  function countWaitingSets() {
    const email = window.WorkoutAuth?.user?.email;

    try {
      const queue = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");

      return Array.isArray(queue) && email ? queue.filter(row => row?.email === email).length : 0;
    } catch {
      return 0;
    }
  }

  function describeWaitingSets(count) {
    if (count === 0) {
      return "";
    }

    return ` ${count} set${count === 1 ? " is" : "s are"} waiting to be sent.`;
  }

  function update() {
    const offline = navigator.onLine === false;
    banner.hidden = !offline;
    banner.textContent = offline
      ? `You are offline. Drafts are saved on this device and unsent sets send when you reconnect.${describeWaitingSets(countWaitingSets())}`
      : "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.body.prepend(banner);
    update();
  });
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  window.addEventListener("storage", update);

  window.WorkoutConnectivity = { refresh: update };
})();
