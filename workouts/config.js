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
    formId: "",
    actionUrl: "",
    fields: {
      email: "",
      configurationId: "",
      routine: "",
      totalSets: "",
      estimatedSeconds: "",
      exercise: "",
      exerciseOrder: "",
      setNumber: "",
      measure: "",
      reps: "",
      durationSeconds: "",
      weightKg: ""
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
