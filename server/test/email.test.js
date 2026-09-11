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
    /domain is not verified/
  );
});
