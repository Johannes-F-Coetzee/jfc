(() => {
  "use strict";

  const STORAGE_KEY = "workout.theme";
  const DEFAULT_THEME = "dark-red";
  const UNITS_STORAGE_KEY = "workout.units";
  const KILOGRAMS_PER_POUND = 0.45359237;
  const THEMES = new Set([
    "dark-red", "dark-green", "dark-blue",
    "light-red", "light-green", "light-blue"
  ]);
  let theme = DEFAULT_THEME;
  let units = "metric";
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

    const savedUnits = localStorage.getItem(UNITS_STORAGE_KEY);

    if (savedUnits === "metric" || savedUnits === "imperial") {
      units = savedUnits;
    } else if (savedUnits !== null) {
      const message = "The saved units are not supported. Using Metric.";
      storageMessage = [storageMessage, message].filter(Boolean).join(" ");
      console.warn(message);
    }
  } catch (error) {
    storageMessage = "Your saved settings could not be read. Changes may not be remembered on this device.";
    console.error(storageMessage, error);
  }

  document.documentElement.dataset.theme = theme;

  window.WorkoutSettings = {
    get units() { return units; },
    get weightUnit() { return units === "imperial" ? "lb" : "kg"; },
    weightFromKg(value, system = units) {
      return system === "imperial" ? value / KILOGRAMS_PER_POUND : value;
    },
    weightToKg(value, system = units) {
      return system === "imperial" ? value * KILOGRAMS_PER_POUND : value;
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const menu = document.querySelector("#settings-menu");
    const selector = document.querySelector("#theme-select");
    const status = document.querySelector("#settings-status");
    const unitsSelector = document.querySelector("#units-select");
    selector.value = theme;
    unitsSelector.value = units;
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

    unitsSelector.addEventListener("change", () => {
      const previousUnits = units;
      units = unitsSelector.value;
      document.dispatchEvent(new CustomEvent("workout:unitschange", { detail: { previousUnits } }));

      try {
        localStorage.setItem(UNITS_STORAGE_KEY, units);
        status.textContent = "Units saved on this device.";
      } catch (error) {
        status.textContent = "Units applied, but could not be saved on this device.";
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
