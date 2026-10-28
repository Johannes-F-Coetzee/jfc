(() => {
  "use strict";

  class RequestError extends Error {
    constructor(status, body) {
      super(body?.error?.message || `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }

    get reason() {
      const details = this.body?.error?.details || [];

      return details.map(detail => detail.reason).find(Boolean) || this.body?.error?.status || "";
    }
  }

  function hasSubmissionConfiguration(configuration, { requiredFields = [], uniqueEntries = false } = {}) {
    const fields = configuration.fields || {};
    const entries = requiredFields.length ? requiredFields.map(field => fields[field]) : Object.values(fields);
    const isEntry = entry => /^entry\.\d+$/.test(entry || "");

    return /^https:\/\/docs\.google\.com\/forms\/.+\/formResponse$/.test(configuration.actionUrl || "") &&
      (requiredFields.length ? entries.every(isEntry) : entries.some(isEntry)) &&
      (!uniqueEntries || new Set(entries).size === entries.length);
  }

  async function fetchResource(path, token) {
    const response = await fetch(`https://forms.googleapis.com/v1/forms/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new RequestError(response.status, body);
    }

    if (!body) {
      throw new Error("Google Forms returned an invalid response.");
    }

    return body;
  }

  function buildQuestionMap(configuration, definition, questionFieldNames) {
    const fieldsByEntryNumber = new Map();
    Object.entries(configuration.fields || {}).forEach(([fieldName, entryId]) => {
      const match = /^entry\.(\d+)$/.exec(entryId || "");

      if (match) {
        fieldsByEntryNumber.set(Number(match[1]), fieldName);
      }
    });
    const fieldsByQuestionId = new Map();
    (definition.items || []).forEach(item => {
      const questionId = item.questionItem?.question?.questionId;

      if (!questionId) {
        return;
      }

      const fieldName = fieldsByEntryNumber.get(parseInt(questionId, 16)) ||
        questionFieldNames[(item.title || "").trim().toLowerCase()];

      if (fieldName) {
        fieldsByQuestionId.set(questionId, fieldName);
      }
    });

    return fieldsByQuestionId;
  }

  async function fetchAllResponses(configuration, token) {
    const responses = [];
    let nextPageToken = "";

    do {
      const parameters = new URLSearchParams({ pageSize: "5000" });

      if (nextPageToken) {
        parameters.set("pageToken", nextPageToken);
      }

      const page = await fetchResource(
        `${encodeURIComponent(configuration.formId)}/responses?${parameters}`, token
      );
      responses.push(...(page.responses || []));
      nextPageToken = page.nextPageToken || "";
    } while (nextPageToken);

    return responses;
  }

  function decodeResponse(response, questionMap) {
    const row = {};
    Object.entries(response.answers || {}).forEach(([questionId, answer]) => {
      const fieldName = questionMap.get(questionId);

      if (fieldName) {
        row[fieldName] = answer.textAnswers?.answers?.[0]?.value ?? "";
      }
    });

    return row;
  }

  async function readForm(configuration, questionFieldNames, {
    requiredFields = [],
    missingFieldsMessage = "The Google Form is missing required tracker questions.",
    retryUnauthorized = false
  } = {}) {
    const owner = window.WorkoutAuth.user;

    if (!owner) {
      throw new Error("Sign in before reading Google Forms data.");
    }

    if (!configuration.formId) {
      throw new Error("Configure the Google Form ID before reading responses.");
    }

    const assertCurrentUser = () => {
      if (window.WorkoutAuth.user !== owner) {
        throw new Error("The signed-in account changed.");
      }
    };
    const readWithToken = async token => {
      assertCurrentUser();
      const definition = await fetchResource(encodeURIComponent(configuration.formId), token);
      assertCurrentUser();
      const questionMap = buildQuestionMap(configuration, definition, questionFieldNames);
      const mappedFields = new Set(questionMap.values());

      if (!requiredFields.every(field => mappedFields.has(field))) {
        throw new Error(missingFieldsMessage);
      }

      const responses = await fetchAllResponses(configuration, token);
      assertCurrentUser();

      return { responses, questionMap };
    };

    try {
      return await readWithToken(await window.WorkoutAuth.getFormsAccessToken());
    } catch (error) {
      assertCurrentUser();

      if (!(error instanceof RequestError) || error.status !== 401) {
        throw error;
      }

      window.WorkoutAuth.clearCachedToken();

      if (!retryUnauthorized) {
        throw error;
      }

      try {
        return await readWithToken(await window.WorkoutAuth.getFormsAccessToken({ forceNew: true }));
      } catch (retryError) {
        assertCurrentUser();

        if (retryError instanceof RequestError && retryError.status === 401) {
          window.WorkoutAuth.clearCachedToken();
        }

        throw retryError;
      }
    }
  }

  async function postRow(configuration, row) {
    if (!hasSubmissionConfiguration(configuration)) {
      throw new Error("Configure the Google Form action URL and entry IDs before submitting.");
    }

    const body = new URLSearchParams();

    for (const [fieldName, entry] of Object.entries(configuration.fields || {})) {
      const value = row[fieldName];

      if (entry && value !== null && value !== undefined && value !== "") {
        body.append(entry, String(value));
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      // Form responses are opaque: callers must not treat a completed POST as confirmed storage.
      await fetch(configuration.actionUrl, {
        method: "POST", mode: "no-cors", body, signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  window.WorkoutForms = {
    RequestError, hasSubmissionConfiguration, fetchResource, buildQuestionMap,
    fetchAllResponses, decodeResponse, readForm, postRow
  };
})();
