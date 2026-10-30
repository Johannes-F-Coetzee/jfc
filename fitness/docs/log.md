# Log page

Behaviour of [`index.html`](../index.html). Back to the [setup guide](../../README.md).

- **Google sign-in** (Google Identity Services). An optional email allow-list restricts access.
- Per exercise you choose **Reps** or **Time**, then log each set. Each set records reps or duration (with a built-in stopwatch), optional weight, **difficulty (RPE 1–10)** from a dropdown, and optional notes (tap **+ Note** to add one). **Clear workout** sits below Submit and can be reversed with **Undo** until you edit the workout again; on phones, Submit and the time estimate stay pinned to the bottom of the screen.
- **Google Forms backend**: every set is posted as one form response, so the linked Google Sheet gets one row per set.
- Submitting a workout or measurement with a future date prompts for confirmation before it is queued or sent.
- **Shared workout configurations** live in a separate Google Form, with one response per set. If none have been loaded, the Log page tries to load them once while signed in. An empty result or failed attempt is not retried automatically until the page is refreshed, even if you sign out and back in. If Google needs to show its permission window, the status asks you to choose **Routine actions → Refresh routines**, which remains available for manual reloads. Selecting a saved routine from the Routine dropdown immediately fills the workout. **Routine actions → Save as routine** saves the current exercises and sets under a unique name, together with the signed-in person's email and the estimated workout time in seconds. Configurations cannot be edited, overwritten, or deleted from the site; use a new name to save a variation.
- **Routine actions → Export routines (JSON)** downloads all complete configurations from the last successful form load in the legacy `{"routines": [...]}` format. It does not include unsaved changes in the editor, author/time metadata, or incomplete/conflicting configurations (which are reported in the status). The download is still named `routines.json`, but the site no longer reads a routines file.
- **Routine name:** when shared routines are available, choosing one from the dropdown immediately replaces the current exercises and sets with that routine, keeping the selected date. Choose **Capture new** to type a new name without changing exercises; the **×** button inside the text field clears only the name. **Choose a saved routine** returns to the dropdown without changing exercises. With no shared routines, the text field appears automatically. Drafts retain their routine name, including names not in the loaded list; restoring a draft or refreshing the routine list does not reload its routine or overwrite in-progress edits.
- An **estimated time** is shown next to *Submit workout*. Timed sets count as entered, each rep counts as 10 seconds, and 1 minute of rest is added between consecutive sets.
- The in-progress workout is auto-saved as a draft, and submissions made while offline are queued and retried. Workout and measurement submissions use the same status flow: submissions are saved on this device before sending, and a sent status means the request was sent, not that Google Forms confirmed storage.
- **Settings** across Log, Trends, and Measurements includes eight themes: Dark Red (the default), Dark Green, Dark Blue, Dark Grey, Light Red, Light Green, Light Blue, and Light Grey. Changes apply immediately to both the page and its favicon and are remembered on this device, without requiring sign-in.
- **Units** in Settings selects Metric (kg, the default) or Imperial (lb) for weight entry, trend tables, and weight/volume charts. Switching units converts current entries without clearing the workout. The preference is remembered on this device across all three pages; drafts, queued submissions, shared configurations, and exports continue to store kilograms for compatibility.
- **Default exercise measure** in Settings selects Reps (the default) or Time for new exercises, including the first exercise in a new or cleared workout. The preference is remembered on this device and can be changed on Log or Trends. Existing exercises, restored drafts, and saved configurations retain their recorded measure; each exercise can still be changed individually.


## Configuration saves and recovery

Each configuration set response records `configurationId`, `routine`, `email`, `totalSets`, `estimatedSeconds`, `exercise`, `exerciseOrder`, `setNumber`, `measure`, and the applicable `reps`/`durationSeconds` and optional `weightKg`. The shared ID groups the set rows; exercise and set positions preserve ordering, even for repeated exercise names.

Names are checked against fresh form responses before saving, ignoring case and surrounding whitespace. Incomplete saves reserve their name but are not offered for loading or exported. A save is only reported as successful after all its sets can be read back. If a save fails, retry on the same device/account with the **same name and unchanged sets**; the pending configuration ID is retained locally for that account/name so confirmed sets are not posted again.

Google Forms provides neither transactions nor a server-side unique-name constraint. Simultaneous saves can still collide; conflicting names are reported and withheld from loading/export rather than silently replacing a workout. A timed-out POST can also reach the form after the browser gives up. Resolve conflicting or duplicate responses in Google Forms, not on the site. Configuration saving requires a network connection and form-read access; it does not use the offline workout-log queue.

The legacy routines file is no longer a data source. To migrate an existing routine, enter its exercises/sets in the tracker and save it once to the configuration form.

## JSON export format

```json
{
  "routines": [
    {
      "name": "Upper body A",
      "exercises": [
        { "name": "Push-ups", "measure": "reps", "sets": [{ "reps": 12 }, { "reps": 10, "weightKg": 5 }] },
        { "name": "Plank", "measure": "time", "sets": [{ "durationSeconds": 45 }] }
      ]
    }
  ]
}
```

`measure` is either `reps` or `time`. Each set may set `reps` (for reps), `durationSeconds` (for time) and an optional `weightKg`.

## Local data export and import

**Export my data** (under *Recent workouts*) downloads this account's draft workout, unsent sets and recent workouts as JSON; **Import data** merges such a file back in (existing entries win, duplicates are skipped, the draft is only restored when none exists). Files from another account are rejected. Unsent sets are stored on this device only, and a full or blocked browser storage is reported instead of silently losing the workout.

## Suggested workout

The **Suggested workout** card (signed-in view) reads the saved plans from the plan form, using the same Forms pipeline and permissions as routines and the Plan page. Plans load automatically on sign-in; **Refresh plans** retries if Google needs a permission popup. Choose a plan and the card lists what to log for the date in the form, each with a button that loads that routine. The chosen plan is remembered per account on this device under `workout.activePlan:<email>`.

- A plan repeats its cycle forever after its start date; before the start date nothing is suggested.
- Workouts scheduled on the chosen date are suggested first. Ones scheduled up to two days earlier are offered too, marked *Missed*, so a skipped session is not forgotten. Future sessions are never suggested.
- A routine already logged within one day either side of its scheduled day (name compared ignoring case) is not suggested. Logged workouts come from the workout log form for the signed-in account, plus recent history and unsent sets on this device. If the form cannot be read, the card says suggestions only consider this device's workouts.
- If a suggested routine is not in the loaded shared routines, its button is disabled until routines load.

The rules live in [`plan-schedule.js`](../plan-schedule.js) (`OVERDUE_LOOKBACK_DAYS`, `LOGGED_TOLERANCE_DAYS`), the form reader in [`logged-workouts.js`](../logged-workouts.js) and the card in [`workout-suggestions.js`](../workout-suggestions.js).

## Local data and accounts

Everything the Log page keeps on this device belongs to one account: the draft workout (`workout.draft:<email>`), recent workouts (`workout.history:<email>`) and unsent sets (rows in `workout.queue`, each tagged with its `email`). Accounts that share a browser never see or send each other's data, and signing out clears the form. The pending-save entries for routines and plans, the selected plan and the Track and Plan page data were already stored per account. Theme, units and default measure stay device-wide preferences.

History and drafts saved before this change had no owner (`workout.history`, `workout.draft`). The first account to sign in afterwards adopts them: they are merged into that account's data and the old keys are removed once the copy succeeds. On a device that more than one person used, whoever signs in first receives that older history, because it never recorded who logged it. Only the last 20 workouts were kept, and nothing sent to Google Forms is affected.
