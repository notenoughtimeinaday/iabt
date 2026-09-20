import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCreditCheckout,
  createCustomerPortal,
  createSubscriptionCheckout
} from "../src/billing/stripe-checkout.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";

const config = loadConfig({
  NODE_ENV: "test",
  IABT_AUTH_SECRET: "stripe-checkout-test-secret",
  IABT_PUBLIC_ORIGIN: "https://insuredspending.org",
  IABT_STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_configured",
  STRIPE_WEBHOOK_SECRET: "whsec_configured",
  STRIPE_BUILDER_PRICE_ID: "price_builder",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_AGENCY_PRICE_ID: "price_agency",
  STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_credit_pack"
});

const makeUser = (repository, email) =>
  repository.createUser({
    email,
    passwordHash: "unused",
    emailVerified: true
  });

const mockProviders = () => {
  const calls = [];
  return {
    calls,
    readiness: () => ({
      stripe: { configured: true, checkout_ready: true, mode: "test" }
    }),
    execute: async (provider, operation, payload, context) => {
      calls.push({ provider, operation, payload, context });
      return {
        durable: false,
        data: {
          id: payload.path === "/checkout/sessions" ? "cs_test_123" : "bps_test_123",
          url: "https://checkout.stripe.test/session"
        }
      };
    }
  };
};

test("subscription checkout uses the configured price and server-owned user metadata", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "checkout@example.com");
  const providers = mockProviders();
  const result = await createSubscriptionCheckout({
    repository,
    providers,
    config,
    user,
    plan: "pro",
    idempotencyKey: "subscription-checkout-test"
  });
  assert.equal(result.kind, "checkout");
  assert.equal(result.session_id, "cs_test_123");
  assert.equal(providers.calls.length, 1);
  const call = providers.calls[0];
  assert.equal(call.provider, "stripe");
  assert.equal(call.operation, "post");
  assert.equal(call.payload.path, "/checkout/sessions");
  assert.equal(call.payload.params["line_items[0][price]"], "price_pro");
  assert.equal(call.payload.params["metadata[user_id]"], user.id);
  assert.equal(call.payload.params["subscription_data[metadata][user_id]"], user.id);
  assert.equal(call.context.approval.approved, true);
  assert.equal(call.context.approval.live_confirmed, false);
});

test("credit checkout carries the server-owned pack size and payment metadata", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "credits@example.com");
  const providers = mockProviders();
  const result = await createCreditCheckout({
    repository,
    providers,
    config,
    user,
    idempotencyKey: "credit-checkout-test"
  });
  assert.equal(result.kind, "checkout");
  const params = providers.calls[0].payload.params;
  assert.equal(params.mode, "payment");
  assert.equal(params["line_items[0][price]"], "price_credit_pack");
  assert.equal(params["metadata[credits]"], "100");
  assert.equal(params["payment_intent_data[metadata][product_type]"], "ai_credit_pack");
});

test("an existing managed subscription routes to the customer portal", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "portal@example.com");
  await repository.createRecord("AccountEntitlement", user, {
    user_id: user.id,
    user_email: user.email,
    plan: "pro",
    status: "active",
    billing_provider: "stripe",
    provider_customer_id: "cus_existing",
    provider_subscription_id: "sub_existing"
  });
  const providers = mockProviders();
  const result = await createSubscriptionCheckout({
    repository,
    providers,
    config,
    user,
    plan: "agency",
    idempotencyKey: "existing-subscription-test"
  });
  assert.equal(result.kind, "portal");
  assert.equal(providers.calls[0].payload.path, "/billing_portal/sessions");
  assert.equal(providers.calls[0].payload.params.customer, "cus_existing");

  const direct = await createCustomerPortal({
    repository,
    providers,
    config,
    user,
    idempotencyKey: "direct-portal-test"
  });
  assert.equal(direct.kind, "portal");
  assert.equal(providers.calls[1].payload.params.return_url, "https://insuredspending.org/");
});

test("payment-recovery subscriptions use the portal even when new checkout prices are unavailable", async () => {
  for (const status of ["incomplete", "unpaid", "past_due", "paused", "inactive"]) {
    const repository = new MemoryRepository();
    const user = await makeUser(repository, status + "@example.test");
    await repository.createRecord("AccountEntitlement", user, {
      user_id: user.id, status, plan: "free", billing_provider: "stripe",
      provider_customer_id: "cus_recovery", provider_subscription_id: "sub_recovery"
    });
    const providers = mockProviders();
    providers.readiness = () => ({ stripe: { configured: true, checkout_ready: false, mode: "test" } });
    const result = await createSubscriptionCheckout({ repository, providers, config, user, plan: "pro", idempotencyKey: "recover-" + status });
    assert.equal(result.kind, "portal");
    assert.equal(providers.calls.length, 1);
    assert.equal(providers.calls[0].payload.path, "/billing_portal/sessions");
  }
});

test("canceled subscriptions may restart checkout while unconfigured checkout never calls Stripe", async () => {
  const repository = new MemoryRepository();
  const user = await makeUser(repository, "restart@example.test");
  await repository.createRecord("AccountEntitlement", user, { user_id: user.id, status: "canceled", billing_provider: "stripe", provider_customer_id: "cus_restart", provider_subscription_id: "sub_canceled" });
  const providers = mockProviders();
  assert.equal((await createSubscriptionCheckout({ repository, providers, config, user, plan: "builder", idempotencyKey: "restart" })).kind, "checkout");
  providers.readiness = () => ({ stripe: { configured: false, checkout_ready: false } });
  await assert.rejects(createCreditCheckout({ repository, providers, config, user, idempotencyKey: "blocked" }), { code: "stripe_checkout_not_ready" });
  assert.equal(providers.calls.length, 1);
});
