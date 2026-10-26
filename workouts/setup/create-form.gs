/**
 * Google Apps Script that creates the Google Form used as the workout tracker backend.
 *
 * Usage:
 *   1. Open https://script.google.com, create a new project and paste this file.
 *   2. Run `createWorkoutForm` and grant the requested permissions.
 *   3. Open View > Logs (Execution log) and copy the printed `form` block into workouts/config.js.
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

function createWorkoutForm() {
  const form = FormApp.create("Workout Tracker Log");
  form.setDescription("Backend for the workout tracker web app. One response per set.");
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setAcceptingResponses(true);
  try {
    // Only applies to Google Workspace accounts; consumer accounts throw here.
    form.setRequireLogin(false);
  } catch (e) {}
  if (typeof form.setPublished === "function") form.setPublished(true);

  const items = FIELDS.map(([key, title]) => [key, form.addTextItem().setTitle(title)]);

  if (CREATE_RESPONSE_SHEET) {
    const sheet = SpreadsheetApp.create("Workout Tracker Responses");
    form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
    Logger.log("Responses spreadsheet: " + sheet.getUrl());
  }

  // A pre-filled URL reveals the "entry.N" IDs the public form expects.
  const response = form.createResponse();
  items.forEach(([key, item]) => response.withItemResponse(item.createResponse("__" + key + "__")));
  const prefilledUrl = response.toPrefilledUrl();

  const fields = {};
  items.forEach(([key]) => {
    const match = prefilledUrl.match(new RegExp("(entry\\.\\d+)=__" + key + "__"));
    fields[key] = match ? match[1] : "";
  });

  const actionUrl = form.getPublishedUrl().replace(/\/viewform.*$/, "/formResponse");
  const snippet = "form: " + JSON.stringify({ actionUrl: actionUrl, fields: fields }, null, 2);

  Logger.log("Form editor: " + form.getEditUrl());
  Logger.log("Paste into workouts/config.js:\n" + snippet);
}
