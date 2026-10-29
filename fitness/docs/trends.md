# Trends page

Behaviour of [`trends.html`](../trends.html). Back to the [setup guide](../../README.md).

[`trends.html`](../trends.html) reads workout and measurement responses through the **Google Forms API**, using the signed-in Google account. A **User** dropdown lists every email found in either form, with workout set and measurement-entry counts, plus *All users*. It defaults to the signed-in account when that account has data, otherwise to the user with the most recorded entries. For the selected user the page shows:

- summary totals for the selected period (30 days, 90 days, 12 months or all time)
- a per-routine table: workouts, average sets, average estimated time, and difficulty change
- a per-exercise chart and table: total reps, best set, max weight, volume, time, and average difficulty
- a measurement chart and history table for weight, sleep, water, energy, mood, and body circumferences; one latest response is shown per date, and metric and period filters apply
- an all-measurements overview with entry counts, last measured date, latest value, and change over the selected period; select a measurement name to open its trend
- an all-exercises overview with the change since the previous workout

**Exercise trend**, **Measurement trend**, **All exercises**, and **All measurements** can each be expanded or collapsed using their headings. They start expanded and remember their last state on this device. Selecting an exercise or measurement in an overview expands its trend section before scrolling to its chart.

Reading workout or measurement responses requires **edit access to the corresponding form**. Trends tries to load automatically on sign-in; if Google needs to show its permission window, press **Load my data**. After the first successful Forms read, missing, rejected, or expired tokens can trigger another permission popup. The User filter appears only when either form has data from more than one person. **Load my data** can also re-read both forms and their responses from Google (bypassing the browser cache), discarding previously loaded results. The status line shows when the data was loaded. Measurement access problems are reported separately so workout trends remain available. When the signed-in account can't read the workout form (or `form.formId` isn't set), the page shows step-by-step instructions for forking this repository and setting up a personal copy.
