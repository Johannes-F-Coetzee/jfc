const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");
const { loadInternals, loadUtilities, readSource } = require("./helpers.cjs");

const plain = value => JSON.parse(JSON.stringify(value));
const configuration = (() => {
  const window = {};
  runInNewContext(readSource("config.js"), { window });

  return plain(window.WORKOUT_CONFIG);
})();
const formsWindow = {};
runInNewContext(readSource("google-forms.js"), { window: formsWindow });
const { hasSubmissionConfiguration } = formsWindow.WorkoutForms;
const FORM_BLOCKS = ["form", "configurationForm", "measurementsForm", "planForm"];
const script = readSource("setup/create-form.gs");

// Field definitions from create-form.gs: [key, question title, optional choices].
function setupFields(constantName) {
  const block = new RegExp(`const ${constantName} = \\[([\\s\\S]*?)\\n\\];`).exec(script)[1];

  return [...block.matchAll(/\[\s*"([^"]+)",\s*"([^"]+)"(?:,\s*\[([^\]]*)\])?\s*\]/g)].map(match => ({
    key: match[1], title: match[2], choices: match[3] ? [...match[3].matchAll(/"([^"]+)"/g)].map(choice => choice[1]) : null
  }));
}

const SETUP_CONSTANTS = {
  form: "FIELDS", configurationForm: "CONFIGURATION_FIELDS", measurementsForm: "MEASUREMENT_FIELDS", planForm: "PLAN_FIELDS"
};

test("every form block is complete: form id, response URL, and unique entry ids", () => {
  for (const name of FORM_BLOCKS) {
    const block = configuration[name];

    assert.ok(block, `${name} is configured`);
    assert.match(block.formId, /^[\w-]{20,}$/, `${name}.formId looks like a Forms edit id`);
    assert.ok(hasSubmissionConfiguration(block, { uniqueEntries: true }), `${name} can accept submissions`);
    assert.ok(Object.values(block.fields).every(entry => /^entry\.\d+$/.test(entry)), `${name} entries are entry.N`);
  }
});

test("no two forms share an id, action URL or entry id", () => {
  const formIds = FORM_BLOCKS.map(name => configuration[name].formId);
  const actionUrls = FORM_BLOCKS.map(name => configuration[name].actionUrl);
  const entries = FORM_BLOCKS.flatMap(name => Object.values(configuration[name].fields));

  assert.equal(new Set(formIds).size, formIds.length);
  assert.equal(new Set(actionUrls).size, actionUrls.length);
  assert.equal(new Set(entries).size, entries.length, "an entry id is reused between forms");
});

test("config.js maps exactly the fields that create-form.gs creates, form by form", () => {
  for (const name of FORM_BLOCKS) {
    const created = setupFields(SETUP_CONSTANTS[name]).map(field => field.key).sort();

    assert.ok(created.length > 5, `${name}: parsed the setup fields`);
    assert.deepEqual(Object.keys(configuration[name].fields).sort(), created, name);
  }
});

test("the Trends page's question titles and dropdown options match the measurement form that setup creates", () => {
  const trends = loadInternals("trends.js", ["MEASUREMENT_QUESTION_FIELD_NAMES", "MEASUREMENT_METRIC_DEFINITIONS"], {
    window: loadUtilities(), WorkoutSettings: { units: "metric", weightUnit: "kg" }
  });
  const titles = plain(trends.MEASUREMENT_QUESTION_FIELD_NAMES);
  const created = setupFields("MEASUREMENT_FIELDS");

  assert.deepEqual(Object.entries(titles).map(([title, key]) => [title, key]).sort(),
    created.map(field => [field.title.toLowerCase(), field.key]).sort(),
    "Trends falls back to question titles, so they must match the setup script");

  for (const field of created.filter(entry => entry.choices)) {
    assert.deepEqual(plain(trends.MEASUREMENT_METRIC_DEFINITIONS[field.key].options), field.choices,
      `${field.key} options differ between Trends and the setup script`);
  }
});

test("the workout form's question titles match what Trends reads", () => {
  const trends = loadInternals("trends.js", ["FORM_QUESTION_FIELD_NAMES"], { window: loadUtilities() });
  const titles = plain(trends.FORM_QUESTION_FIELD_NAMES);

  for (const field of setupFields("FIELDS")) {
    assert.equal(titles[field.title.toLowerCase()], field.key, `Trends does not recognise "${field.title}"`);
  }
});

test("sign-in is configured and the allow-list, when used, holds email addresses", () => {
  assert.match(configuration.googleClientId, /^\d+-[\w]+\.apps\.googleusercontent\.com$/);
  assert.ok(Array.isArray(configuration.allowedEmails));
  assert.ok(configuration.allowedEmails.every(email => /^[^@\s]+@[^@\s]+$/.test(email)));
});
