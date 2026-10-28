(() => {
  "use strict";

  const STORAGE_KEY = "workout.theme";
  const DEFAULT_THEME = "dark-red";
  const UNITS_STORAGE_KEY = "workout.units";
  const DEFAULT_MEASURE_STORAGE_KEY = "workout.defaultMeasure";
  const KILOGRAMS_PER_POUND = 0.45359237;
  const THEMES = new Set([
    "dark-red", "dark-green", "dark-blue", "dark-grey",
    "light-red", "light-green", "light-blue", "light-grey"
  ]);
  let theme = DEFAULT_THEME;
  let units = "metric";
  let defaultMeasure = "reps";
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

    const savedMeasure = localStorage.getItem(DEFAULT_MEASURE_STORAGE_KEY);

    if (savedMeasure === "reps" || savedMeasure === "time") {
      defaultMeasure = savedMeasure;
    } else if (savedMeasure !== null) {
      const message = "The saved default measure is not supported. Using Reps.";
      storageMessage = [storageMessage, message].filter(Boolean).join(" ");
      console.warn(message);
    }
  } catch (error) {
    storageMessage = "Your saved settings could not be read. Changes may not be remembered on this device.";
    console.error(storageMessage, error);
  }

  document.documentElement.dataset.theme = theme;

  function updateFavicon() {
    const favicon = document.querySelector('link[rel="icon"]');
    const styles = getComputedStyle(document.documentElement);
    const background = styles.getPropertyValue("--bg").trim();
    const foreground = styles.getPropertyValue("--text").trim();
    const accent = styles.getPropertyValue("--accent").trim();
    const image = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill="${background}"/>
      <g stroke="${foreground}" stroke-width="3" stroke-linecap="round">
        <line x1="18" y1="6" x2="18" y2="31"/>
        <line x1="46" y1="6" x2="46" y2="31"/>
      </g>
      <g fill="none" stroke="${accent}" stroke-width="4.5">
        <circle cx="18" cy="41" r="9.5"/>
        <circle cx="46" cy="41" r="9.5"/>
      </g>
    </svg>`;
    favicon.href = `data:image/svg+xml,${encodeURIComponent(image)}`;
  }

  window.WorkoutSettings = {
    get defaultMeasure() { return defaultMeasure; },
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
    updateFavicon();
    const menu = document.querySelector("#settings-menu");
    const selector = document.querySelector("#theme-select");
    const status = document.querySelector("#settings-status");
    const unitsSelector = document.querySelector("#units-select");
    const measureSelector = document.querySelector("#default-measure-select");
    selector.value = theme;
    unitsSelector.value = units;
    measureSelector.value = defaultMeasure;
    status.textContent = storageMessage;

    selector.addEventListener("change", () => {
      theme = selector.value;
      document.documentElement.dataset.theme = theme;
      updateFavicon();

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

    measureSelector.addEventListener("change", () => {
      defaultMeasure = measureSelector.value;

      try {
        localStorage.setItem(DEFAULT_MEASURE_STORAGE_KEY, defaultMeasure);
        status.textContent = "Default measure saved on this device.";
      } catch (error) {
        status.textContent = "Default measure applied, but could not be saved on this device.";
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
