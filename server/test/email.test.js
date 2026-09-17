import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { createTransactionalEmailSender } from "../src/email/resend.js";

test("transactional email is fail-closed when Resend is not configured", async () => {
  const config = loadConfig({ NODE_ENV: "test" });
  const sender = createTransactionalEmailSender(config, {
    fetchImpl: async () => {
      throw new Error("network should not be called");
    }
  });
  assert.equal(sender.configured, false);
  await assert.rejects(
    sender.sendChallenge({
      to: "owner@example.com",
      code: "123456",
      purpose: "verify_email"
    }),
    /Transactional email is not configured/
  );
});

test("Resend sender emits a verification email without leaking the API key", async () => {
  const requests = [];
  const config = loadConfig({
    NODE_ENV: "production",
    IABT_AUTH_SECRET: "production-email-test-secret",
    IABT_DATABASE_URL: "postgresql://example.invalid/iabt",
    RESEND_API_KEY: "re_test_fixture",
    IABT_EMAIL_PROVIDER: "resend",
    IABT_EMAIL_FROM: "IABT <noreply@example.com>",
    IABT_EMAIL_REPLY_TO: "support@example.com"
  });
  const sender = createTransactionalEmailSender(config, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(sender.configured, true);
  const result = await sender.sendChallenge({
    to: "owner@example.com",
    code: "654321",
    purpose: "verify_email"
  });

  assert.equal(result.id, "email_123");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.equal(requests[0].options.headers.Authorization, "Bearer re_test_fixture");
  const payload = JSON.parse(requests[0].options.body);
  assert.deepEqual(payload.to, ["owner@example.com"]);
  assert.equal(payload.reply_to, "support@example.com");
  assert.match(payload.subject, /Verify/);
  assert.match(payload.text, /654321/);
  assert.equal(JSON.stringify(payload).includes("re_test_fixture"), false);
});

test("Resend delivery failures are surfaced", async () => {
  const config = loadConfig({
    NODE_ENV: "production",
    IABT_AUTH_SECRET: "production-email-test-secret",
    IABT_DATABASE_URL: "postgresql://example.invalid/iabt",
    RESEND_API_KEY: "re_test_fixture",
    IABT_EMAIL_PROVIDER: "resend",
    IABT_EMAIL_FROM: "IABT <noreply@example.com>"
  });
  const sender = createTransactionalEmailSender(config, {
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: "domain is not verified" }), {
        status: 403,
        headers: { "Content-Type": "application/json" }
      })
  });

  await assert.rejects(
    sender.sendChallenge({
      to: "owner@example.com",
      code: "123456",
      purpose: "reset_password"
    }),
    (error) => error.code === "email_delivery_failed" && error.status === 403 && !error.message.includes("domain")
  );
});

test("email health reports sanitized delivery failure and recovers after confirmed acceptance", async () => {
  let rejected = true;
  const sender = createTransactionalEmailSender({ email: { provider: "resend", apiKey: "test-key", from: "test@example.test" } }, {
    fetchImpl: async () => new Response(JSON.stringify(rejected ? { message: "private-provider-error" } : { id: "accepted-test" }), { status: rejected ? 503 : 200 })
  });
  assert.equal((await sender.health()).verification, "configuration_only");
  await assert.rejects(sender.sendChallenge({ to: "test@example.test", code: "123456", purpose: "verify_email" }));
  assert.deepEqual(await sender.health(), { ok: false, adapter: "resend", reason: "email_delivery_failed", last_failure: { classification: "provider_unavailable", http_status: 503 } });
  rejected = false;
  await sender.sendChallenge({ to: "test@example.test", code: "123456", purpose: "verify_email" });
  assert.deepEqual(await sender.health(), { ok: true, adapter: "resend", verification: "provider_acceptance_observed" });
});


test("email diagnostics classify documented provider failures without exposing private fields", async () => {
  const cases = [
    ["validation_error", 403, "sender_not_authorized"],
    ["restricted_api_key", 403, "credential_restricted"],
    ["suspended_api_key", 403, "credential_suspended"],
    ["invalid_permission", 403, "permission_denied"],
    ["missing_api_key", 401, "authentication_failed"],
    ["daily_quota_exceeded", 429, "quota_exceeded"],
    ["monthly_quota_exceeded", 429, "quota_exceeded"],
    ["rate_limit_exceeded", 429, "rate_limited"],
    ["invalid_idempotent_request", 409, "idempotency_conflict"],
    ["validation_error", 400, "invalid_request"],
    ["service_unavailable", 503, "provider_unavailable"],
    ["private-recipient@example.test 998877 re_PRIVATE", 403, "permission_denied"]
  ];
  for (const [name, status, classification] of cases) {
    const logs = [];
    let attempts = 0;
    const sender = createTransactionalEmailSender({ email: { provider: "resend", apiKey: "re_PRIVATE", from: "private-sender@example.test" } }, {
      logger: (event) => logs.push(event),
      fetchImpl: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ name, message: "private-recipient@example.test 998877 re_PRIVATE", code: "private-provider-code" }), { status });
      }
    });
    await assert.rejects(sender.sendChallenge({ to: "private-recipient@example.test", code: "998877", purpose: "reset_password" }),
      (error) => error.code === "email_delivery_failed" && !error.message.includes("PRIVATE"));
    assert.equal(attempts, 1);
    const health = await sender.health();
    assert.deepEqual(health.last_failure, { classification, http_status: status });
    assert.deepEqual(logs, [{ event: "iabt_email_delivery_failed", provider: "resend", classification, http_status: status }]);
    assert.doesNotMatch(JSON.stringify({ health, logs }), /private-|998877|re_PRIVATE/);
  }
});

test("network and timeout diagnostics omit raw errors, and failing logging cannot replace the delivery error", async () => {
  for (const [name, classification] of [["TimeoutError", "timeout"], ["TypeError", "network_error"]]) {
    const logs = [];
    const sender = createTransactionalEmailSender({ email: { provider: "resend", apiKey: "re_PRIVATE", from: "private@example.test" } }, {
      logger: (event) => { logs.push(event); throw new Error("private-logger-error"); },
      fetchImpl: async () => { throw Object.assign(new Error("private@example.test re_PRIVATE 998877"), { name }); }
    });
    await assert.rejects(sender.sendChallenge({ to: "private@example.test", code: "998877", purpose: "reset_password" }),
      (error) => error.code === "email_delivery_failed" && !error.message.includes("PRIVATE") && !error.message.includes("logger"));
    const health = await sender.health();
    assert.deepEqual(health.last_failure, { classification, http_status: null });
    assert.doesNotMatch(JSON.stringify({ health, logs }), /private|998877|re_PRIVATE/);
  }
});
