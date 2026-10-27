// Workout tracker configuration. See README.md ("Workout tracker setup") for how to obtain these values.
window.WORKOUT_CONFIG = {
  // OAuth 2.0 Web client ID from Google Cloud Console (APIs & Services > Credentials).
  // Add your GitHub Pages origin (e.g. https://johannes-f-coetzee.github.io) as an Authorized JavaScript origin.
  googleClientId: "342022081719-u4gek6jp96tgtegv1ki3jv2qrjnt8p5h.apps.googleusercontent.com",

  // Optional allow-list of Google account emails permitted to use the tracker. Empty = any Google account.
  allowedEmails: [],

  // Run createWorkoutConfigurationForm in setup/create-form.gs and replace this block with its output.
  // All tracker users need edit access to this separate form to load shared configurations.
  configurationForm: {
    formId: "1TKDkX7yQa2u2PlDVgzomM21kOXZeJ4DWlDd4cxt2qTU",
    actionUrl: "https://docs.google.com/forms/d/e/1FAIpQLScX-29g_1vBC9AP_9FjnWnLCSv0g02lJVBmCSyaovIV12bzHA/formResponse",
    fields: {
      email: "entry.500493512",
      configurationId: "entry.478004740",
      routine: "entry.1945946843",
      totalSets: "entry.1297113112",
      estimatedSeconds: "entry.312672126",
      exercise: "entry.271444766",
      exerciseOrder: "entry.402679829",
      setNumber: "entry.2099256338",
      measure: "entry.96786282",
      reps: "entry.633409149",
      durationSeconds: "entry.222802795",
      weightKg: "entry.1584499751"
    }
  },

  form: {
    // Edit ID of the form, used by the Trends page to read responses through the Google Forms API.
    // It's the long ID in the form editor URL: https://docs.google.com/forms/d/<FORM_ID>/edit (not the /d/e/... ID).
    formId: "1qwejcaS2fOFDaRCV5kc5mgQGzDW3QvVN51Hmt3K-rsA",

    // https://docs.google.com/forms/d/e/<FORM_ID>/formResponse
    actionUrl: "https://docs.google.com/forms/d/e/1FAIpQLSekRNtRNtRDK-Uc00wci2ssLaoVX2jwJ0ayfvf0KNkRDV1AwA/formResponse",

    // Map of tracker field -> Google Form entry ID ("entry.123456789"). Leave a value empty to skip that field.
    fields: {
      email: "entry.448484238",
      sessionId: "entry.284578121",
      date: "entry.1483904993",
      routine: "entry.484867954",
      exercise: "entry.12160301",
      exerciseOrder: "entry.350760846",
      setNumber: "entry.503601321",
      measure: "entry.1474920164",
      reps: "entry.733381588",
      durationSeconds: "entry.1604295884",
      weightKg: "entry.68854287",
      rpe: "entry.1179740046",
      notes: "entry.1734180164",
      sessionNotes: "entry.342498244"
    }
  }
};
