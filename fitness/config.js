// Fitness tracker configuration. See README.md ("Fitness tracker setup") for how to obtain these values.
window.WORKOUT_CONFIG = {
  // OAuth 2.0 Web client ID from Google Cloud Console (APIs & Services > Credentials).
  // Add your GitHub Pages origin (e.g. https://johannes-f-coetzee.github.io) as an Authorized JavaScript origin.
  googleClientId: "342022081719-u4gek6jp96tgtegv1ki3jv2qrjnt8p5h.apps.googleusercontent.com",

  // Optional allow-list of Google account emails permitted to use the tracker. Empty = any Google account.
  // Enforced in the browser only: it hides the interface but does not protect data. Access to the Google Forms
  // (and their response spreadsheets) is the real boundary.
  allowedEmails: [],

  // Run createMeasurementsForm in setup/create-form.gs and replace this block with its output.
  measurementsForm: {
    formId: "1wl5Jc8tkOkVEc4QwvGtorl9oEyKGoYmL7moCB55aNIs",
    actionUrl: "https://docs.google.com/forms/d/e/1FAIpQLSeykqz6xv9jdJUjENRJ5jBUGQ5jsq7TBpRXCOJoim3_Az57vg/formResponse",
    fields: {
      email: "entry.1909002342",
      measurementId: "entry.1700252134",
      date: "entry.1572627875",
      neckCm: "entry.723827793",
      bicepLCm: "entry.2100569363",
      bicepRCm: "entry.1757414732",
      forearmLCm: "entry.638760680",
      forearmRCm: "entry.1499011081",
      shouldersCm: "entry.1818035447",
      chestCm: "entry.681764983",
      waistCm: "entry.1463500471",
      bellyCm: "entry.546071577",
      buttCm: "entry.1293589352",
      thighLCm: "entry.158230002",
      thighRCm: "entry.1959648336",
      calfLCm: "entry.104314781",
      calfRCm: "entry.1248096544",
      weightKg: "entry.349622649",
      sleepHours: "entry.650920054",
      waterLitres: "entry.438971393",
      energy: "entry.793785980",
      mood: "entry.1933251641"
    }
  },

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

  // Run createWorkoutPlanForm in setup/create-form.gs and replace this block with its output.
  // Plan reads require edit access to this separate form.
  planForm: {
    formId: "1fn8Qa33JGGQ8WSpQj_sH0yF-OzziBOhpyxsYsWSXRS8",
    actionUrl: "https://docs.google.com/forms/d/e/1FAIpQLSeYqPI4kX1whevWMQRKg2GU6ssbM_m83BtWCLOgPSqCj1Vy6w/formResponse",
    fields: {
      email: "entry.1924532178",
      planId: "entry.1604769508",
      planName: "entry.648385210",
      duration: "entry.704551280",
      durationUnit: "entry.1414625885",
      startDate: "entry.49689005",
      totalRoutines: "entry.1669619232",
      routineOrder: "entry.2025836555",
      cycleDay: "entry.264452298",
      routine: "entry.1100658434"
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
