export function normalizeCreationCapabilities(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([, item]) => item && typeof item === "object" && !Array.isArray(item))
    .map(([intent, item]) => ({ ...item, intent }));
}

export function mediaReadiness(capabilities, intent) {
  const capability = capabilities.find((item) => item.intent === intent || item.id === intent);
  if (capability?.configured === true) return "route configured; execution and approval checks still apply";
  if (capability?.configured === false) return "provider setup required";
  return "availability not confirmed";
}

export function studioErrorMessage(error, fallback = "Something went wrong.") {
  return [error?.response?.data?.message, error?.data?.message, error?.message,
    error?.response?.data?.error, error?.data?.error]
    .find((value) => typeof value === "string" && value.trim()) || fallback;
}

// Keep the id through an uncertain response; only confirmed acceptance retires it.
// The synchronous gate also covers clicks before React renders its busy state.
export function createStudioSubmissionGate(newId = () => crypto.randomUUID()) {
  let busy = false;
  let submission = null;
  return {
    get busy() { return busy; },
    acquire() {
      if (busy) return false;
      busy = true;
      return true;
    },
    idFor(key) {
      if (!busy) throw new Error("Acquire the submission gate before preparing a request.");
      if (submission?.key !== key) submission = { key, id: newId() };
      return submission.id;
    },
    accepted() { submission = null; },
    release() { busy = false; },
  };
}

export function refreshAcceptedSubmission(refreshConversations, refreshResources) {
  // These are projections of a request already accepted by the server. A failed
  // refresh must never imply that the send failed or prompt another submission.
  return Promise.allSettled([
    Promise.resolve().then(refreshConversations),
    Promise.resolve().then(refreshResources),
  ]);
}
