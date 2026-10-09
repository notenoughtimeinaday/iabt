const transientCodes = new Set([
  "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
  "storage_verification_failed", "TimeoutError", "AbortError"
]);

export function classifyFailure(error) {
  const code = String(error?.code || error?.cause?.code || error?.name || "execution_failed").slice(0, 100);
  const retryable = Boolean(error?.retryable || transientCodes.has(code) || /rate_limited|provider_unavailable/.test(code));
  return {
    code, retryable,
    repair: retryable ? "retry_with_backoff" : "escalate",
    safe_message: retryable
      ? "A temporary problem is being repaired. Your work is saved."
      : "This step needs attention before work can continue."
  };
}
