# Plan page

Behaviour of [`plan.html`](../plan.html). Back to the [setup guide](../../README.md).

[`plan.html`](../plan.html) captures a plan name and a positive whole-number cycle duration in days or weeks. Choose **Apply plan details** before adding routines; changing details requires applying them again. One week means seven days.

Choose a **Start date** to date the cycle days. The Calendar card displays the entire configured cycle in one continuous Monday-first grid, with a single weekday header, compact date numbers, inline month markers, and a highlight for today. Both day-based and week-based cycles show each full month covered by the cycle, with dates outside the cycle marked unavailable. Week-based cycles only accept Monday start dates (the date field uses seven-day steps anchored to a Monday). The previous/next controls and cycle week input select the month or week for routine capture without hiding other calendar dates. Routine capture only offers dates within the cycle. Changing the start date moves existing routines with their numbered cycle days. Shortening a cycle is blocked if it would exclude scheduled routines; remove those entries first. **Refresh routines** loads saved routines and requests Google Forms access when necessary.

Switching a weekly plan to **Days** keeps its current valid start date; an empty date defaults to today. Switching to **Weeks** uses the next Monday (the following week if today is Monday). New plans also default to the next Monday. Apply the details to save the change.

The calendar keeps seven weekday columns at every screen size. On smaller screens, scroll within the keyboard-focusable Calendar card to view the remaining columns without widening the page.

Routines load automatically on sign-in, including a restored sign-in when the page loads. Dropdowns show **Routines loading...** until the request finishes, then display the loaded options. Empty results and failures are shown in the dropdown and status; **Refresh routines** retries loading if Google requires a permission popup. Refreshing preserves selections that are still available.

Hover over a date within the cycle (or focus it with the keyboard) to reveal **+ Add**. Touchscreens always show the button. If details have not been applied, Add takes you to the plan details with guidance; if routines have not loaded, Add attempts to load them and reports any access errors. Choose a routine in the inline dropdown and press the check button to save it on that date, independently of the capture controls above. Press Escape to cancel the inline picker. Apply plan details before saving routines; dates outside the cycle cannot capture routines.

Saving a day closes only that day's inline picker. Open pickers and unsaved selections on other dates are kept while the calendar updates.

Visible dates after the cycle ends preview the repeating routine schedule for both duration units. These previews have no add or remove controls and are not saved as extra routines. Dates before the plan starts remain empty. Editing a routine within the cycle updates its future previews.

The plan is saved per signed-in account on this device under `plan.cycle:<email>` as `{name, duration, unit, startDate, routines}`, where `startDate` is `YYYY-MM-DD` and `routines` maps one-based cycle day numbers to routine-name arrays. Older cycle plans using `entries` are read as `routines` and use the new name when next saved. Existing cycle plans without a start date keep their routines; apply a start date to resume capture. Export uses the same shape. Clearing routines keeps the details. Earlier date-based `plan.calendar:<email>` data is left untouched and is not converted into cycle days.

## Google Forms plan snapshots

The **Saved plans** card saves and loads named snapshots using a separate Google Form. The local draft still saves automatically; **Apply plan details** and calendar check buttons do not submit snapshots. Apply the details, add at least one routine, and confirm or cancel all open pickers before choosing **Save plan to Google Forms**. Snapshots cannot be overwritten: use a new name for changes. Names are unique per account, ignoring case. The list loads automatically on sign-in; use **Refresh saved plans** to retry permission requests or refresh the form data. **Load selected plan** replaces the local draft after confirmation and preserves the snapshot's start date. Editing the loaded draft does not change the stored snapshot.

Each scheduled routine is a separate form response with all plan details repeated:

| Field | Value |
|-------|-------|
| `email` | Signed-in account |
| `planId` | Shared identifier for the snapshot |
| `planName` | Plan name |
| `duration`, `durationUnit` | Cycle duration and `days`/`weeks` |
| `startDate` | `YYYY-MM-DD` |
| `totalRoutines` | Number of scheduled routine rows in the snapshot |
| `routineOrder` | One-based row order |
| `cycleDay` | One-based day within the cycle |
| `routine` | Saved routine name |

Rest days and future read-only previews do not create rows. Multiple routines on one day create multiple rows. Routine names reference the shared configurations; exercises and sets are not duplicated in the plan form.

A save succeeds only after every row is read back through the Forms API. If it fails, retry on the same device/account with the same name and unchanged details/routines; `plan.pendingSnapshot:<email>:<name>` retains the identifier so confirmed rows are skipped. Incomplete or conflicting snapshots reserve their name but are withheld from the load list and reported in the status. Forms has no transactions or server-side uniqueness, so concurrent saves can conflict; resolve duplicate/conflicting rows in Google Forms. This is an online save operation, not an offline submission queue.

To create the backend:

1. Run **`createWorkoutPlanForm`** from [`fitness/setup/create-form.gs`](../setup/create-form.gs) in your Google Apps Script project.
2. Paste its logged **`planForm: {...}`** block into [`fitness/config.js`](../config.js), replacing only the empty `planForm` block. Keep existing log, routine configuration, and measurement form blocks.
3. Publish the new form and enable anonymous responses, with automatic email collection and one-response limits disabled. Do not rename its questions. The script also creates a response spreadsheet.
4. Give each tracker user **edit access** to this form. Enable the Google Forms API and the same two read-only OAuth scopes used for routines/trends. No new scopes are required.

Without setup, the page displays instructions and disables cloud controls; local drafting, calendar capture, and export remain available. The UI lists only the signed-in email's snapshots, but this is not a privacy boundary: form editors can read all responses directly, and anonymous email values are claimed attribution. Share the backend only with trusted users.
