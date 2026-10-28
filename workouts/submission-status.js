(() => {
  "use strict";

  function setStatus(element, message, kind = "") {
    element.textContent = message;
    element.className = `status ${kind}`;
  }

  function titleCase(subject) {
    return subject.charAt(0).toUpperCase() + subject.slice(1);
  }

  window.WorkoutSubmissionStatus = {
    set: setStatus,
    submitting: subject => `Submitting ${subject}…`,
    sent: subject => `${titleCase(subject)} submission sent.`,
    queued: subject => `${titleCase(subject)} submission is saved on this device and will be sent automatically when possible.`,
    retrying: subject => `Retrying pending ${subject} submissions…`,
    retrySent: subject => `Pending ${subject} submissions sent.`,
    retryQueued: subject => `Pending ${subject} submissions remain queued on this device. Retry when connected.`
  };
})();
