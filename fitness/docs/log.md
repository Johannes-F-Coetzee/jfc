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
