/**
 * Google Apps Script that creates the Google Form used as the fitness tracker backend.
 *
 * Usage:
 *   1. Open https://script.google.com, create a new project and paste this file.
 *   2. Run `createWorkoutForm` for logs and `createWorkoutConfigurationForm` for shared configurations.
 *      Run `createMeasurementsForm` for measurements and daily states.
 *   3. Copy the printed configuration blocks into workouts/config.js.
 */

const CREATE_RESPONSE_SHEET = true;

const FIELDS = [
  ["email", "Email"],
  ["sessionId", "Session ID"],
  ["date", "Workout date"],
  ["routine", "Routine"],
  ["exercise", "Exercise"],
  ["exerciseOrder", "Exercise order"],
  ["setNumber", "Set number"],
  ["measure", "Measure (reps/time)"],
  ["reps", "Reps"],
  ["durationSeconds", "Duration (seconds)"],
  ["weightKg", "Weight (kg)"],
  ["rpe", "Perceived difficulty (RPE 1-10)"],
  ["notes", "Set notes"],
  ["sessionNotes", "Session notes"]
];

const CONFIGURATION_FIELDS = [
  ["email", "Email"],
  ["configurationId", "Configuration ID"],
  ["routine", "Routine"],
  ["totalSets", "Total sets"],
  ["estimatedSeconds", "Estimated time (seconds)"],
  ["exercise", "Exercise"],
  ["exerciseOrder", "Exercise order"],
  ["setNumber", "Set number"],
  ["measure", "Measure (reps/time)"],
  ["reps", "Reps"],
  ["durationSeconds", "Duration (seconds)"],
  ["weightKg", "Weight (kg)"]
];

const MEASUREMENT_FIELDS = [
  ["email", "Email"],
  ["measurementId", "Measurement ID"],
  ["date", "Measurement date"],
  ["neckCm", "Neck (cm)"],
  ["bicepLCm", "Bicep L (cm)"],
  ["bicepRCm", "Bicep R (cm)"],
  ["forearmLCm", "Forearm L (cm)"],
  ["forearmRCm", "Forearm R (cm)"],
  ["shouldersCm", "Shoulders (cm)"],
  ["chestCm", "Chest (cm)"],
  ["waistCm", "Waist (cm)"],
  ["bellyCm", "Belly (cm)"],
  ["buttCm", "Butt (cm)"],
  ["thighLCm", "Thigh L (cm)"],
  ["thighRCm", "Thigh R (cm)"],
  ["calfLCm", "Calf L (cm)"],
  ["calfRCm", "Calf R (cm)"],
  ["weightKg", "Weight (kg)"],
  ["sleepHours", "Sleep (hours)"],
  ["waterLitres", "Water (litres)"],
  ["energy", "Energy", ["spent", "weak", "tired", "fair", "good", "strong"]],
  ["mood", "Mood", ["bad", "poor", "meh", "fair", "good", "great"]]
];

function createWorkoutForm() {
  createTrackerForm("Workout Tracker Log", "form", FIELDS);
}

function createWorkoutConfigurationForm() {
  createTrackerForm("Workout Tracker Configurations", "configurationForm", CONFIGURATION_FIELDS);
}

function createMeasurementsForm() {
  createTrackerForm("Fitness Tracker Measurements", "measurementsForm", MEASUREMENT_FIELDS,
    "Backend for fitness measurements and daily states. One response per submission. Do not rename questions.");
}

function createTrackerForm(title, configurationKey, fieldDefinitions,
  description = "Backend for the workout tracker web app. One response per set. Do not rename questions.") {
  const form = FormApp.create(title);
  form.setDescription(description);
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setAcceptingResponses(true);

  try {
    // Only applies to Google Workspace accounts; consumer accounts throw here.
    form.setRequireLogin(false);
  } catch {
  }

  if (typeof form.setPublished === "function") {
    form.setPublished(true);
  }

  const items = fieldDefinitions.map(([key, questionTitle, choices]) => {
    const item = choices
      ? form.addListItem().setTitle(questionTitle).setChoiceValues(choices)
      : form.addTextItem().setTitle(questionTitle);

    return [key, item, choices ? choices[0] : "__" + key + "__"];
  });

  if (CREATE_RESPONSE_SHEET) {
    const sheet = SpreadsheetApp.create(title + " Responses");
    form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
    Logger.log("Responses spreadsheet: " + sheet.getUrl());
  }

  // A pre-filled URL reveals the "entry.N" IDs the public form expects.
  const response = form.createResponse();
  items.forEach(([key, item, value]) => response.withItemResponse(item.createResponse(value)));
  const prefilledUrl = response.toPrefilledUrl();
  const fields = {};
  items.forEach(([key, item, value]) => {
    const match = prefilledUrl.match(new RegExp("(entry\\.\\d+)=" + encodeURIComponent(value) + "(?:&|$)"));
    fields[key] = match ? match[1] : "";
  });
  const actionUrl = form.getPublishedUrl().replace(/\/viewform.*$/, "/formResponse");
  const snippet = configurationKey + ": " + JSON.stringify({ formId: form.getId(), actionUrl: actionUrl, fields: fields }, null, 2);
  Logger.log("Form editor: " + form.getEditUrl());
  Logger.log("Paste into workouts/config.js:\n" + snippet);
}
