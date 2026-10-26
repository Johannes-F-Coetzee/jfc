# jfc.github.io

Static GitHub Pages site.

| Page | Path |
|------|------|
| Home | [`index.html`](index.html) |
| Workout tracker | [`workouts/`](workouts/) |

## Workout tracker

`workouts/` is a mobile-friendly page for logging an exercise routine:

- **Google sign-in** (Google Identity Services). An optional email allow-list restricts access.
- Per exercise you choose **Reps** or **Time**, then log each set. Each set records reps or duration (with a built-in stopwatch), optional weight, **perceived difficulty (RPE 1–10)**, and notes.
- **Google Forms backend**: every set is posted as one form response, so the linked Google Sheet gets one row per set.
- Routines are saved locally so you can reload them, the in-progress workout is auto-saved as a draft, and submissions made while offline are queued and retried.

### Workout tracker setup

1. **Create the Google Form**
   - Open <https://script.google.com>, create a new project, and paste in [`workouts/setup/create-form.gs`](workouts/setup/create-form.gs).
   - Run `createWorkoutForm` and grant access. This creates the form plus a linked response spreadsheet.
   - Copy the logged `form: {...}` block into [`workouts/config.js`](workouts/config.js).
   - Prefer to build the form by hand? Add one *Short answer* question per field listed in `config.js`. Then open **⋮ → Get pre-filled link**, fill in each field, and copy the `entry.NNN` IDs from the generated URL. The action URL is the form's `/viewform` URL with `viewform` replaced by `formResponse`.
   - The form must be **published**, must **not** require sign-in, and must **not** collect email addresses or limit responses to one per person. Otherwise the anonymous POST from the site is rejected.

2. **Create the Google OAuth client ID**
   - In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen, then go to **Create credentials → OAuth client ID → Web application**.
   - Under *Authorized JavaScript origins*, add `https://johannes-f-coetzee.github.io` (and `http://localhost:8000` for local testing).
   - Put the client ID in `googleClientId` in [`workouts/config.js`](workouts/config.js).
   - Optionally, list permitted accounts in `allowedEmails`.

3. **Publish**: commit and push, and make sure GitHub Pages is enabled for the branch under *Settings → Pages*. The tracker is served at `https://johannes-f-coetzee.github.io/jfc.github.io/workouts/`.

Local testing: `python -m http.server 8000`, then open <http://localhost:8000/workouts/>.

### Security notes

GitHub Pages is static hosting, so sign-in gates only the user interface. The Google Form's `formResponse` URL is public in the page source, and anyone who finds it could submit data directly. Keep the response spreadsheet private, and treat the `email` column as identifying who logged each set, not as proof of who did.