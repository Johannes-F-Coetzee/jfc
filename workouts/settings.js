(() => {
  "use strict";

  const STORAGE_KEY = "workout.theme";
  const DEFAULT_THEME = "dark-red";
  const THEMES = new Set([
    "dark-red", "dark-green", "dark-blue",
    "light-red", "light-green", "light-blue"
  ]);
  let theme = DEFAULT_THEME;
  let storageMessage = "";

  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY);

    if (savedTheme !== null) {
      if (THEMES.has(savedTheme)) {
        theme = savedTheme;
      } else {
        storageMessage = "The saved theme is not supported. Using Dark Red.";
        console.warn(storageMessage);
      }
    }
  } catch (error) {
    storageMessage = "Your saved theme could not be read. Changes may not be remembered on this device.";
    console.error(storageMessage, error);
  }

  document.documentElement.dataset.theme = theme;

  document.addEventListener("DOMContentLoaded", () => {
    const menu = document.querySelector("#settings-menu");
    const selector = document.querySelector("#theme-select");
    const status = document.querySelector("#settings-status");
    selector.value = theme;
    status.textContent = storageMessage;

    selector.addEventListener("change", () => {
      theme = selector.value;
      document.documentElement.dataset.theme = theme;

      try {
        localStorage.setItem(STORAGE_KEY, theme);
        status.textContent = "Theme saved on this device.";
      } catch (error) {
        status.textContent = "Theme applied, but could not be saved on this device.";
        console.error(status.textContent, error);
      }
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && menu.open) {
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });

    document.addEventListener("click", event => {
      if (menu.open && !menu.contains(event.target)) {
        menu.open = false;
      }
    });
  });
})();
