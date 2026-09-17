const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const subjectForPurpose = (purpose) =>
  purpose === "reset_password"
    ? "Reset your IABT password"
    : "Verify your IABT account";

const copyForPurpose = (purpose) =>
  purpose === "reset_password"
    ? "Use this code to reset your IABT password."
    : "Use this code to verify your IABT account.";

// Only these documented names affect diagnostics. Never log Resend's message,
// unknown names, request/response bodies, addresses, API keys, or OTPs.
// Source: https://resend.com/docs/api-reference/errors
const failureClasses = new Map([
  ["missing_api_key", "authentication_failed"],
  ["restricted_api_key", "credential_restricted"],
  ["suspended_api_key", "credential_suspended"],
  ["invalid_permission", "permission_denied"],
  ["email_above_quota", "quota_exceeded"],
  ["daily_quota_exceeded", "quota_exceeded"],
  ["monthly_quota_exceeded", "quota_exceeded"],
  ["rate_limit_exceeded", "rate_limited"],
  ["invalid_idempotency_key", "invalid_request"],
  ["concurrent_idempotent_requests", "idempotency_conflict"],
  ["invalid_idempotent_request", "idempotency_conflict"],
  ["resource_locked", "provider_conflict"],
  ["invalid_attachment", "invalid_request"],
  ["invalid_parameter", "invalid_request"],
  ["missing_required_field", "invalid_request"],
  ["missing_required_parameter", "invalid_request"],
  ["not_found", "endpoint_rejected"],
  ["method_not_allowed", "endpoint_rejected"],
  ["application_error", "provider_unavailable"],
  ["service_unavailable", "provider_unavailable"]
]);

const classifyResponse = (name, status) => {
  if (name === "validation_error") return status === 403 ? "sender_not_authorized" : "invalid_request";
  if (failureClasses.has(name)) return failureClasses.get(name);
  if (status === 401) return "authentication_failed";
  if (status === 403) return "permission_denied";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "request_rejected";
};

export const createTransactionalEmailSender = (
  config,
  { fetchImpl = globalThis.fetch, logger = (event) => console.warn(JSON.stringify(event)) } = {}
) => {
  const email = config.email || {};
  const provider = String(email.provider || "disabled").toLowerCase();
  const configured =
    provider === "resend" && Boolean(email.apiKey) && Boolean(email.from);
  let deliveryFailed = false;
  let deliveryObserved = false;
  let lastFailure = null;

  return Object.freeze({
    kind: provider,
    configured,
    async health() {
      if (!configured) return { ok: false, adapter: provider || "disabled", reason: "not_configured" };
      return deliveryFailed
        ? { ok: false, adapter: "resend", reason: "email_delivery_failed", last_failure: { ...lastFailure } }
        : { ok: true, adapter: "resend", verification: deliveryObserved ? "provider_acceptance_observed" : "configuration_only" };
    },
    async sendChallenge({ to, code, purpose, idempotencyKey }) {
      if (!configured) {
        const error = new Error("Transactional email is not configured");
        error.code = "email_not_configured";
        throw error;
      }

      let failure = null;
      try {
        const subject = subjectForPurpose(purpose);
        const intro = copyForPurpose(purpose);
        const safeCode = escapeHtml(code);
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(email.timeoutMs || 10000),
          headers: {
            Authorization: `Bearer ${email.apiKey}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
          },
          body: JSON.stringify({
            from: email.from,
            to: [to],
            ...(email.replyTo ? { reply_to: email.replyTo } : {}),
            subject,
            text: `${intro}\n\n${code}\n\nThis code expires soon. If you did not request this, you can ignore this message.`,
            html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111827"><div style="max-width:560px;margin:0 auto;padding:24px"><h2 style="margin:0 0 16px">${escapeHtml(subject)}</h2><p>${escapeHtml(intro)}</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${safeCode}</div><p style="color:#6b7280;font-size:14px">This code expires soon. If you did not request this, you can ignore this message.</p><p style="color:#6b7280;font-size:14px">IABT — Intelligent App Building Technology</p></div></body></html>`
          })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          failure = { classification: classifyResponse(payload?.name, response.status), http_status: response.status };
          throw new Error("Email provider rejected the message");
        }

        const result = await response.json().catch(() => null);
        if (!result?.id) {
          failure = { classification: "invalid_provider_response", http_status: response.status };
          throw new Error("Email provider did not confirm acceptance");
        }
        deliveryFailed = false;
        deliveryObserved = true;
        lastFailure = null;
        return result;
      } catch (error) {
        deliveryFailed = true;
        lastFailure = failure || {
          classification: ["AbortError", "TimeoutError"].includes(error?.name) ? "timeout" : "network_error",
          http_status: null
        };
        try {
          logger({ event: "iabt_email_delivery_failed", provider: "resend", ...lastFailure });
        } catch {
          // Diagnostics must not change the delivery result or expose the original error.
        }
        throw Object.assign(new Error("Email provider could not accept the message"), {
          code: "email_delivery_failed",
          ...(lastFailure.http_status ? { status: lastFailure.http_status } : {})
        });
      }
    }
  });
};
