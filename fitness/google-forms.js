(() => {
  "use strict";

  const READ_PERMISSIONS = [
    "https://www.googleapis.com/auth/forms.body.readonly",
    "https://www.googleapis.com/auth/forms.responses.readonly"
  ];

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

  async function postRow(configuration, row) {
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

  window.WorkoutForms = { READ_PERMISSIONS, RequestError, fetchResource, buildQuestionMap, fetchAllResponses, postRow };
})();
