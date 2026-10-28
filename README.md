# jfc.github.io

Static GitHub Pages site.

| Page | Path |
|------|------|
| Home | [`index.html`](index.html) |
| Fitness tracker | [`fitness/`](fitness/) |
| Fitness trends | [`fitness/trends.html`](fitness/trends.html) |
| Fitness tracking | [`fitness/track.html`](fitness/track.html) |

## Fitness tracker

`fitness/` is a mobile-friendly page for logging an exercise routine:

- **Google sign-in** (Google Identity Services). An optional email allow-list restricts access.
- Per exercise you choose **Reps** or **Time**, then log each set. Each set records reps or duration (with a built-in stopwatch), optional weight, **difficulty (RPE 1–10)** from a dropdown, and optional notes (tap **+ Note** to add one). **Clear workout** sits below Submit and can be reversed with **Undo** until you edit the workout again; on phones, Submit and the time estimate stay pinned to the bottom of the screen.
- **Google Forms backend**: every set is posted as one form response, so the linked Google Sheet gets one row per set.
- **Shared workout configurations** live in a separate Google Form, with one response per set. If none have been loaded, the Log page tries to load them once while signed in. An empty result or failed attempt is not retried automatically until the page is refreshed, even if you sign out and back in. If Google needs to show its permission window, the status asks you to choose **Routine actions → Refresh routines**, which remains available for manual reloads. Selecting a saved routine from the Routine dropdown immediately fills the workout. **Routine actions → Save as routine** saves the current exercises and sets under a unique name, together with the signed-in person's email and the estimated workout time in seconds. Configurations cannot be edited, overwritten, or deleted from the site; use a new name to save a variation.
- **Routine actions → Export routines (JSON)** downloads all complete configurations from the last successful form load in the legacy `{"routines": [...]}` format. It does not include unsaved changes in the editor, author/time metadata, or incomplete/conflicting configurations (which are reported in the status). The download is still named `routines.json`, but the site no longer reads a routines file.
- **Routine name:** when shared routines are available, choosing one from the dropdown immediately replaces the current exercises and sets with that routine, keeping the selected date. Choose **Capture new** to type a new name without changing exercises; the **×** button inside the text field clears only the name. **Choose a saved routine** returns to the dropdown without changing exercises. With no shared routines, the text field appears automatically. Drafts retain their routine name, including names not in the loaded list; restoring a draft or refreshing the routine list does not reload its routine or overwrite in-progress edits.
- An **estimated time** is shown next to *Submit workout*. Timed sets count as entered, each rep counts as 10 seconds, and 1 minute of rest is added between consecutive sets.
- The in-progress workout is auto-saved as a draft, and submissions made while offline are queued and retried. Workout and measurement submissions use the same status flow: submissions are saved on this device before sending, and a sent status means the request was sent, not that Google Forms confirmed storage.
- **Settings** across Log, Trends, and Measurements includes six themes: Dark Red (the default), Dark Green, Dark Blue, Light Red, Light Green, and Light Blue. Changes apply immediately to both the page and its favicon and are remembered on this device, without requiring sign-in.
- **Units** in Settings selects Metric (kg, the default) or Imperial (lb) for weight entry, trend tables, and weight/volume charts. Switching units converts current entries without clearing the workout. The preference is remembered on this device across all three pages; drafts, queued submissions, shared configurations, and exports continue to store kilograms for compatibility.
- **Default exercise measure** in Settings selects Reps (the default) or Time for new exercises, including the first exercise in a new or cleared workout. The preference is remembered on this device and can be changed on Log or Trends. Existing exercises, restored drafts, and saved configurations retain their recorded measure; each exercise can still be changed individually.

### Trends page

[`fitness/trends.html`](fitness/trends.html) reads the form's responses through the **Google Forms API**, using the signed-in Google account. A **User** dropdown lists every email that has logged sets (with set counts) plus *All users*. It defaults to the signed-in account when that account has data, otherwise to the user with the most sets. For the selected user the page shows:

- summary totals for the selected period (30 days, 90 days, 12 months or all time)
- a per-routine table: workouts, average sets, average estimated time, and difficulty change
- a per-exercise chart and table: total reps, best set, max weight, volume, time, and average difficulty
- an all-exercises overview with the change since the previous workout

Reading responses requires **edit access to the form**. Trends tries to load automatically on sign-in; if Google needs to show its permission window, press **Load my data**. The User filter appears only when the form has data from more than one person. **Load my data** can also re-read the form and all responses from Google (bypassing the browser cache), discarding previously loaded results. The status line shows when the data was loaded. When the signed-in account can't read it (or `form.formId` isn't set), the page shows step-by-step instructions for forking this repository and setting up a personal copy.

### Track page

[`fitness/track.html`](fitness/track.html) sends body measurements, weight, sleep, water, energy, and mood to a separate **Google Form**, with one response per submission. Body measurements use centimetres or inches and weight uses kilograms or pounds according to Settings; sleep is in hours and water is in litres or US fluid ounces. Responses always store centimetres (`neckCm`, `bicepLCm`, etc.), kilograms (`weightKg`), hours (`sleepHours`), and litres (`waterLitres`), plus `email`, `measurementId`, `date`, `energy`, and `mood`. The page groups fields into Body, Daily state, and Circumference, in that order. Energy and mood are dropdowns with the same options as the page.

**Submit measurements** uses the same full-width submit row as the Log page, staying pinned to the bottom of the screen on phones. **Clear fields** and submission status appear below it. **Undo** restores cleared fields and their date until you edit the form, submit, load a history entry, or change accounts. Clearing fields does not delete history or queued submissions.

The latest entry per date and all pending submissions are stored together on this device, separately for each signed-in account. Network failures retain the pending responses, which retry on sign-in, when the browser comes online, or with **Retry now**. A completed anonymous Google Forms POST is opaque: the page reports that requests were sent, not that Google confirmed storage. A timeout or storage failure after sending may cause a duplicate response on retry; `measurementId` identifies retries of the same submission.

**Edit** fills the form from local history; submitting it appends a new Google Form response, rather than editing or replacing any earlier response. The local daily history updates to the latest submitted values. Previous device-only entries are preserved but are not automatically uploaded; use **Edit** and **Submit measurements** to send them. The page does not load history from Google or synchronize history across devices.

To configure measurements, run **`createMeasurementsForm`** from [`fitness/setup/create-form.gs`](fitness/setup/create-form.gs) in Google Apps Script, grant access, and copy its logged **`measurementsForm: {...}`** block into [`fitness/config.js`](fitness/config.js), replacing the empty measurements block only. This creates a separate form and linked response spreadsheet. Publish it, allow anonymous responses, disable automatic email collection and one-response limits, and leave measurement questions optional so partial entries can be submitted. No additional OAuth scopes or form-edit permission are needed to submit measurements. All entry mappings are required; missing or duplicate mappings disable submission and show setup instructions.

### Fitness tracker setup

1. **Create the Google Form**
   - Open <https://script.google.com>, create a new project, and paste in [`fitness/setup/create-form.gs`](fitness/setup/create-form.gs).
   - Run `createWorkoutForm` and grant access. This creates the form plus a linked response spreadsheet.
   - Copy the logged `form: {...}` block into [`fitness/config.js`](fitness/config.js).
   - Prefer to build the form by hand? Add one *Short answer* question per field listed in `config.js`. Then open **⋮ → Get pre-filled link**, fill in each field, and copy the `entry.NNN` IDs from the generated URL. The action URL is the form's `/viewform` URL with `viewform` replaced by `formResponse`.
   - The form must be **published**, must **not** require sign-in, and must **not** collect email addresses or limit responses to one per person. Otherwise the anonymous POST from the site is rejected.

2. **Create the shared configuration Google Form**
   - In the same Apps Script project, run `createWorkoutConfigurationForm` from [`fitness/setup/create-form.gs`](fitness/setup/create-form.gs).
   - Copy its logged `configurationForm: {...}` block into [`fitness/config.js`](fitness/config.js). This is a separate form from the workout log; do not replace the existing `form` block.
   - Apply the same publishing/anonymous-response settings as the logging form.
   - Share the configuration form with **every tracker user as an editor**. As with trends, the Forms API requires edit access to read responses. The site reads every user's configurations, with no author filter. Form editors can modify data directly in Google Forms, even though the site provides no edit/delete controls.

3. **Create the Google OAuth client ID**
   - In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen, then go to **Create credentials → OAuth client ID → Web application**.
   - Under *Authorized JavaScript origins*, add `https://johannes-f-coetzee.github.io` (and both `http://localhost` and `http://localhost:8000` for local testing).
   - Put the client ID in `googleClientId` in [`fitness/config.js`](fitness/config.js).
   - Optionally, list permitted accounts in `allowedEmails`.

4. **Enable configuration loading and the trends page**
   - Set `form.formId` in [`fitness/config.js`](fitness/config.js). This is the ID in the form **editor** URL (`docs.google.com/forms/d/<formId>/edit`), not the `/d/e/...` published ID. `create-form.gs` logs it for you.
   - In Cloud Console, enable the **Google Forms API** (*APIs & Services → Library*).
   - On the OAuth consent screen, add the scopes `https://www.googleapis.com/auth/forms.body.readonly` and `https://www.googleapis.com/auth/forms.responses.readonly`. While the app is in *Testing*, also add each user as a *test user*.
   - These scopes are required for shared configuration loading/saving too. The first time, choose **Routine actions → Refresh routines** on the tracker or **Load my data** on Trends to grant consent; afterward, data loads automatically on sign-in while the permission token is valid.

5. **Publish**: commit and push, and make sure GitHub Pages is enabled for the branch under *Settings → Pages*. The tracker is served at `https://johannes-f-coetzee.github.io/jfc.github.io/fitness/`.

Local testing: `python -m http.server 8000`, then open <http://localhost:8000/fitness/>. Use an HTTP origin authorized for the OAuth client rather than opening the page directly with `file://`.

Configuration regression tests (Node.js): `node --test fitness/tests/routines.test.cjs`.
Theme/settings regression tests (Node.js): `node --test fitness/tests/settings.test.cjs`.
Track page regression tests (Node.js): `node --test fitness/tests/track.test.cjs`.

### Configuration saves and recovery

Each configuration set response records `configurationId`, `routine`, `email`, `totalSets`, `estimatedSeconds`, `exercise`, `exerciseOrder`, `setNumber`, `measure`, and the applicable `reps`/`durationSeconds` and optional `weightKg`. The shared ID groups the set rows; exercise and set positions preserve ordering, even for repeated exercise names.

Names are checked against fresh form responses before saving, ignoring case and surrounding whitespace. Incomplete saves reserve their name but are not offered for loading or exported. A save is only reported as successful after all its sets can be read back. If a save fails, retry on the same device/account with the **same name and unchanged sets**; the pending configuration ID is retained locally for that account/name so confirmed sets are not posted again.

Google Forms provides neither transactions nor a server-side unique-name constraint. Simultaneous saves can still collide; conflicting names are reported and withheld from loading/export rather than silently replacing a workout. A timed-out POST can also reach the form after the browser gives up. Resolve conflicting or duplicate responses in Google Forms, not on the site. Configuration saving requires a network connection and form-read access; it does not use the offline workout-log queue.

The legacy routines file is no longer a data source. To migrate an existing routine, enter its exercises/sets in the tracker and save it once to the configuration form.

### JSON export format

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

### Security notes

GitHub Pages is static hosting, so sign-in gates only the user interface. All Google Forms' `formResponse` URLs are public in the page source, and anyone who finds them could submit data directly. Share form-edit access only with trusted tracker users, keep the response spreadsheets private, and treat the `email` columns as claimed attribution, not proof of who logged or saved a workout or measurement.