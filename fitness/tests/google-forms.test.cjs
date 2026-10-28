const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const SOURCE = readFileSync(path.join(__dirname, "..", "google-forms.js"), "utf8");
const CONFIGURATION = {
  formId: "test-form",
  actionUrl: "https://docs.google.com/forms/d/e/test-form/formResponse",
  fields: { email: "entry.1", weightKg: "entry.2", mood: "entry.3" }
};
const DEFINITION = {
  items: [
    { title: "Email", questionItem: { question: { questionId: "1" } } },
    { title: "Weight (kg)", questionItem: { question: { questionId: "2" } } },
    { title: "Mood", questionItem: { question: { questionId: "3" } } }
  ]
};
const QUESTION_FIELD_NAMES = { email: "email", "weight (kg)": "weightKg", mood: "mood" };
const settle = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function createEnvironment(options = {}) {
  const requests = [];
  const tokenRequests = [];
  const timers = new Map();
  let clearCount = 0;
  const authentication = {
    user: { email: "current@example.com" },
    async getFormsAccessToken(requestOptions) {
      tokenRequests.push(requestOptions);

      return requestOptions?.forceNew ? "fresh-token" : "cached-token";
    },
    clearCachedToken() { clearCount += 1; }
  };
  const context = {
    WorkoutAuth: authentication,
    URLSearchParams, AbortController,
    setTimeout(callback) {
      const identifier = timers.size + 1;
      timers.set(identifier, callback);

      return identifier;
    },
    clearTimeout: identifier => timers.delete(identifier),
    fetch: async (url, request) => {
      requests.push({ url, request });

      if (options.fetch) {
        return options.fetch(url, request, requests.length);
      }

      return response(url.includes("/responses?") ? { responses: [] } : DEFINITION);
    }
  };
  context.window = context;
  runInNewContext(SOURCE, context);

  return {
    forms: context.WorkoutForms, authentication, requests, tokenRequests, timers,
    get clearCount() { return clearCount; }
  };
}

test("shared submission configuration checks preserve optional workout and required measurement mappings", () => {
  const { forms } = createEnvironment();
  assert.equal(forms.hasSubmissionConfiguration(CONFIGURATION), true);
  assert.equal(forms.hasSubmissionConfiguration({ ...CONFIGURATION, fields: {} }), false);
  assert.equal(forms.hasSubmissionConfiguration({ ...CONFIGURATION, actionUrl: "https://example.test" }), false);
  const optionalFields = { ...CONFIGURATION, fields: { email: "entry.1", mood: "" } };
  assert.equal(forms.hasSubmissionConfiguration(optionalFields), true);
  assert.equal(forms.hasSubmissionConfiguration(optionalFields, { requiredFields: ["email", "mood"] }), false);
  const duplicateFields = { ...CONFIGURATION, fields: { email: "entry.1", mood: "entry.1" } };
  assert.equal(forms.hasSubmissionConfiguration(duplicateFields, { requiredFields: ["email", "mood"] }), true);
  assert.equal(forms.hasSubmissionConfiguration(duplicateFields, {
    requiredFields: ["email", "mood"], uniqueEntries: true
  }), false);
});

test("reads every response page with bearer authorization and no browser caching", async () => {
  const environment = createEnvironment({
    fetch(url) {
      if (!url.includes("/responses?")) {
        return response(DEFINITION);
      }

      const parameters = new URL(url).searchParams;
      assert.equal(parameters.get("pageSize"), "5000");

      return response(parameters.get("pageToken") === "next page"
        ? { responses: [{ responseId: "second" }] }
        : { responses: [{ responseId: "first" }], nextPageToken: "next page" });
    }
  });
  const result = await environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, {
    requiredFields: ["email", "weightKg"]
  });
  assert.deepEqual(plain(result.responses), [{ responseId: "first" }, { responseId: "second" }]);
  assert.equal(result.questionMap.get("2"), "weightKg");
  assert.equal(environment.tokenRequests.length, 1);
  assert.equal(environment.requests.length, 3);
  assert.ok(environment.requests.every(({ request }) =>
    request.headers.Authorization === "Bearer cached-token" && request.cache === "no-store"));
});

test("maps question IDs before falling back to normalized titles and decodes only known fields", () => {
  const { forms } = createEnvironment();
  const questionMap = forms.buildQuestionMap(CONFIGURATION, {
    items: [
      { title: "Mood", questionItem: { question: { questionId: "1" } } },
      { title: " Weight (KG) ", questionItem: { question: { questionId: "beef" } } },
      { title: "Unknown", questionItem: { question: { questionId: "ffff" } } },
      { title: "Section heading" }
    ]
  }, QUESTION_FIELD_NAMES);
  assert.equal(questionMap.get("1"), "email");
  assert.equal(questionMap.get("beef"), "weightKg");
  assert.equal(questionMap.has("ffff"), false);
  assert.deepEqual(plain(forms.decodeResponse({
    answers: {
      "1": { textAnswers: { answers: [{ value: "  user@example.com " }] } },
      beef: { textAnswers: { answers: [{ value: "0" }] } },
      ffff: { textAnswers: { answers: [{ value: "ignored" }] } }
    }
  }, questionMap)), { email: "  user@example.com ", weightKg: "0" });
  assert.deepEqual(plain(forms.decodeResponse({ answers: { "1": {} } }, questionMap)), { email: "" });
});

test("missing required questions fail before responses are downloaded", async () => {
  const environment = createEnvironment();
  await assert.rejects(environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, {
    requiredFields: ["missing"], missingFieldsMessage: "Required question missing."
  }), /Required question missing/);
  assert.equal(environment.requests.length, 1);
});

test("Trends-style reads refresh a rejected token once and retry the complete read", async () => {
  for (const failResponses of [false, true]) {
    const environment = createEnvironment({
      fetch(url, request) {
        if (request.headers.Authorization === "Bearer cached-token" &&
          (failResponses ? url.includes("/responses?") : !url.includes("/responses?"))) {
          return response({ error: { message: "Expired" } }, 401);
        }

        return response(url.includes("/responses?") ? { responses: [] } : DEFINITION);
      }
    });
    await environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, { retryUnauthorized: true });
    assert.equal(environment.clearCount, 1);
    assert.deepEqual(plain(environment.tokenRequests), [null, { forceNew: true }]);
    assert.equal(environment.requests.at(-1).request.headers.Authorization, "Bearer fresh-token");
  }
});

test("routine reads invalidate a rejected token without automatically requesting consent again", async () => {
  const environment = createEnvironment({
    fetch: () => response({ error: { message: "Expired" } }, 401)
  });
  await assert.rejects(environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES),
    error => error instanceof environment.forms.RequestError && error.status === 401);
  assert.equal(environment.clearCount, 1);
  assert.equal(environment.tokenRequests.length, 1);
  assert.equal(environment.requests.length, 1);
});

test("repeated unauthorized responses stop after one refresh and invalidate the replacement token", async () => {
  const environment = createEnvironment({
    fetch: () => response({ error: { message: "Expired" } }, 401)
  });
  await assert.rejects(environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, {
    retryUnauthorized: true
  }), error => error.status === 401);
  assert.equal(environment.clearCount, 2);
  assert.equal(environment.requests.length, 2);
  assert.equal(environment.tokenRequests.length, 2);
});

test("permission and service errors preserve their status, reason and message without retrying", async () => {
  for (const status of [403, 404, 500]) {
    const environment = createEnvironment({
      fetch: () => response({
        error: { message: "Read denied", details: [{ reason: "SERVICE_DISABLED" }] }
      }, status)
    });
    await assert.rejects(environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, {
      retryUnauthorized: true
    }), error => error.status === status && error.reason === "SERVICE_DISABLED" && error.message === "Read denied");
    assert.equal(environment.tokenRequests.length, 1);
  }
});

test("invalid JSON and network failures surface explicitly", async () => {
  for (const failure of ["json", "network"]) {
    const environment = createEnvironment({
      fetch() {
        if (failure === "network") {
          throw new Error("Network unavailable");
        }

        return { ok: true, json: async () => { throw new Error("Invalid JSON"); } };
      }
    });
    await assert.rejects(environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES),
      failure === "network" ? /Network unavailable/ : /invalid response/);
  }
});

test("account changes during reads discard stale data without clearing another account's token", async () => {
  for (const failRequest of [false, true]) {
    let finishRequest;
    const environment = createEnvironment({
      fetch: () => new Promise(resolve => { finishRequest = resolve; })
    });
    const read = environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES, { retryUnauthorized: true });
    const rejected = assert.rejects(read, /account changed/);
    await settle();
    environment.authentication.user = { email: "other@example.com" };
    finishRequest(failRequest ? response({ error: { message: "Expired" } }, 401) : response(DEFINITION));
    await rejected;
    assert.equal(environment.requests.length, 1);
    assert.equal(environment.clearCount, 0);
  }
});

test("missing sign-in or form ID prevents any token or data request", async () => {
  const environment = createEnvironment();
  await assert.rejects(environment.forms.readForm({}, QUESTION_FIELD_NAMES), /Form ID/);
  environment.authentication.user = null;
  await assert.rejects(environment.forms.readForm(CONFIGURATION, QUESTION_FIELD_NAMES), /Sign in/);
  assert.equal(environment.tokenRequests.length, 0);
  assert.equal(environment.requests.length, 0);
});

test("POSTs retain zero, skip blank values and use the same anonymous timeout-bound transport", async () => {
  const environment = createEnvironment({ fetch: () => ({ type: "opaque" }) });
  const result = await environment.forms.postRow(CONFIGURATION, {
    email: "current@example.com", weightKg: 0, mood: "", unknown: "ignored"
  });
  assert.equal(result, undefined);
  const { url, request } = environment.requests[0];
  assert.equal(url, CONFIGURATION.actionUrl);
  assert.equal(request.method, "POST");
  assert.equal(request.mode, "no-cors");
  assert.equal(request.body.toString(), "entry.1=current%40example.com&entry.2=0");
  assert.equal(request.headers, undefined);
  assert.equal(request.signal.aborted, false);
  assert.equal(environment.timers.size, 0);
});

test("POST timeout aborts the request and surfaces its rejection for the caller's queue", async () => {
  const environment = createEnvironment({
    fetch: (url, request) => new Promise((resolve, reject) => {
      request.signal.addEventListener("abort", () => reject(new Error("Request timed out")));
    })
  });
  const post = environment.forms.postRow(CONFIGURATION, { mood: "good" });
  const rejected = assert.rejects(post, /timed out/);
  [...environment.timers.values()][0]();
  await rejected;
  assert.equal(environment.requests[0].request.signal.aborted, true);
  assert.equal(environment.timers.size, 0);
});

test("invalid submission configuration fails before issuing a POST", async () => {
  const environment = createEnvironment();
  await assert.rejects(environment.forms.postRow({}, { mood: "good" }), /Configure/);
  assert.equal(environment.requests.length, 0);
});
