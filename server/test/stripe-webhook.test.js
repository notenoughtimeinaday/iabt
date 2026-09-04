import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import {
  processStripeWebhook,
  verifyStripeEvent
} from "../src/billing/stripe-webhook.js";

const webhookSecret = "whsec_standalone_test_secret";
const nowSeconds = 1788523200;
const sign = (rawBody, timestamp = nowSeconds) => {
  const signature = createHmac("sha256", webhookSecret)
    .update(timestamp + "." + rawBody)
    .digest("hex");
  return "t=" + timestamp + ",v1=" + signature;
};

const config = () =>
  loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "stripe-test-auth-secret",
    IABT_STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_configured",
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_BUILDER_PRICE_ID: "price_builder",
    STRIPE_PRO_PRICE_ID: "price_pro",
    STRIPE_AGENCY_PRICE_ID: "price_agency",
    STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_credit_pack",
    IABT_CREDIT_PACK_SIZE: "100"
  });

test("Stripe webhook signature rejects tampering before any billing mutation", () => {
  const rawBody = JSON.stringify({ id: "evt_tampered", livemode: false });
  assert.throws(
    () =>
      verifyStripeEvent({
        rawBody,
        signatureHeader: sign(rawBody + "tampered"),
        webhookSecret,
        nowSeconds
      }),
    (error) => error.code === "stripe_signature_invalid"
  );
});

test("verified credit-pack events grant once and replay safely", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({
    email: "stripe-credit@example.com",
    passwordHash: "unused",
    emailVerified: true
  });
  const event = {
    id: "evt_credit_pack_1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_credit_1",
        client_reference_id: user.id,
        payment_status: "paid",
        customer_details: { email: user.email },
        metadata: {
          base44_app_id: "6a849bcd3e04d068553b4af7",
          product_type: "ai_credit_pack",
          user_id: user.id,
          user_email: user.email
        }
      }
    }
  };
  const rawBody = JSON.stringify(event);
  const first = await processStripeWebhook({
    rawBody,
    signatureHeader: sign(rawBody),
    repository,
    config: config(),
    nowSeconds
  });
  assert.equal(first.action, "credit_pack_granted");
  assert.equal(first.credits_granted, 100);
  const replay = await processStripeWebhook({
    rawBody,
    signatureHeader: sign(rawBody),
    repository,
    config: config(),
    nowSeconds
  });
  assert.equal(replay.reused, true);
  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 100);
  assert.equal(
    repository.creditEntries.filter((entry) => entry.entry_type === "grant").length,
    1
  );
  const billingEvents = await repository.listRecords("BillingEvent", user, {
    query: { event_id: event.id }
  });
  assert.equal(billingEvents.length, 1);
  assert.equal(repository.stripeEvents.get(event.id).status, "succeeded");
});

test("verified subscription events map configured prices to server-owned entitlements", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({
    email: "stripe-pro@example.com",
    passwordHash: "unused",
    emailVerified: true
  });
  const event = {
    id: "evt_subscription_1",
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: {
        id: "sub_test_1",
        customer: "cus_test_1",
        status: "active",
        cancel_at_period_end: false,
        current_period_end: 1791201600,
        metadata: {
          base44_app_id: "6a849bcd3e04d068553b4af7",
          user_id: user.id,
          user_email: user.email
        },
        items: { data: [{ price: { id: "price_pro" } }] }
      }
    }
  };
  const rawBody = JSON.stringify(event);
  const result = await processStripeWebhook({
    rawBody,
    signatureHeader: sign(rawBody),
    repository,
    config: config(),
    nowSeconds
  });
  assert.equal(result.action, "subscription_entitlement_updated");

  const entitlements = await repository.listRecords("AccountEntitlement", user, {
    query: { user_id: user.id }
  });
  assert.equal(entitlements.length, 1);
  assert.equal(entitlements[0].plan, "pro");
  assert.equal(entitlements[0].status, "active");
  assert.equal(entitlements[0].react_export_enabled, true);
  assert.equal(entitlements[0].commercial_use_enabled, true);
  assert.equal(entitlements[0].provider_subscription_id, "sub_test_1");
});
