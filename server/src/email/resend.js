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

export const createTransactionalEmailSender = (
  config,
  { fetchImpl = globalThis.fetch } = {}
) => {
  const email = config.email || {};
  const provider = String(email.provider || "disabled").toLowerCase();
  const configured =
    provider === "resend" && Boolean(email.apiKey) && Boolean(email.from);

  return Object.freeze({
    kind: provider,
    configured,
    async health() {
      return configured
        ? { ok: true, adapter: "resend" }
        : { ok: false, adapter: provider || "disabled", reason: "not_configured" };
    },
    async sendChallenge({ to, code, purpose }) {
      if (!configured) {
        const error = new Error("Transactional email is not configured");
        error.code = "email_not_configured";
        throw error;
      }

      const subject = subjectForPurpose(purpose);
      const intro = copyForPurpose(purpose);
      const safeCode = escapeHtml(code);
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${email.apiKey}`,
          "Content-Type": "application/json"
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
        const payload = await response.json().catch(() => ({}));
        const error = new Error(
          String(payload?.message || payload?.error || `Resend rejected the message (${response.status})`)
        );
        error.code = "email_delivery_failed";
        error.status = response.status;
        throw error;
      }

      return response.json().catch(() => ({ ok: true }));
    }
  });
};
