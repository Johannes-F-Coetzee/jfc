# jfc.github.io

Static GitHub Pages site.

| Page | Path |
|------|------|
| Home | [`index.html`](index.html) |
| Fitness tracker | [`fitness/`](fitness/) |
| Fitness trends | [`fitness/trends.html`](fitness/trends.html) |
| Fitness tracking | [`fitness/track.html`](fitness/track.html) |
| Fitness plan | [`fitness/plan.html`](fitness/plan.html) |


## Fitness tracker

`fitness/` is a mobile-friendly workout tracker: log workouts, record body measurements, plan routine cycles, and view trends. Data is stored in Google Forms and Sheets, and sign-in uses Google Identity Services. This README covers setup and publishing; per-page behaviour and data formats live in [`fitness/docs/`](fitness/docs/):

| Topic | Doc |
|-------|-----|
| Log page, routine configurations, JSON export | [`log.md`](fitness/docs/log.md) |
| Track page (measurements) | [`track.md`](fitness/docs/track.md) |
| Plan page and plan snapshots | [`plan.md`](fitness/docs/plan.md) |
| Trends page | [`trends.md`](fitness/docs/trends.md) |
| Shared sign-in and Forms modules | [`integration.md`](fitness/docs/integration.md) |

### Setup

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
   - These scopes are required for shared configuration loading/saving too. Choose **Routine actions → Refresh routines** on the tracker or **Load my data** on Trends to grant consent; afterward, data loads automatically on sign-in while the permission token is valid. After the first successful Forms read, missing, rejected, or expired tokens can trigger another permission popup.

5. **Publish**: commit and push, and make sure GitHub Pages is enabled for the branch under *Settings → Pages*. The tracker is served at `https://johannes-f-coetzee.github.io/jfc.github.io/fitness/`.

Local testing: `python -m http.server 8000`, then open <http://localhost:8000/fitness/>. Use an HTTP origin authorized for the OAuth client rather than opening the page directly with `file://`.

Configuration regression tests (Node.js): `node --test fitness/tests/routines.test.cjs`.
Plan snapshot regression tests (Node.js): `node --test fitness/tests/plans.test.cjs`.
Theme/settings regression tests (Node.js): `node --test fitness/tests/settings.test.cjs`.
Track page regression tests (Node.js): `node --test fitness/tests/track.test.cjs`.
Google authentication and Forms integration regression tests (Node.js): `node --test fitness/tests/auth.test.cjs fitness/tests/google-forms.test.cjs`.
All fitness regression tests (Node.js): `npm test` (or `node --test fitness/tests`).

### Security notes

GitHub Pages is static hosting, so sign-in gates only the user interface. All Google Forms' `formResponse` URLs are public in the page source, and anyone who finds them could submit data directly. Share form-edit access only with trusted tracker users, keep the response spreadsheets private, and treat the `email` columns as claimed attribution, not proof of who logged or saved a workout or measurement.