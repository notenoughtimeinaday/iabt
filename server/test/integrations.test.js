import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { handleIntegrationFunction } from "../src/functions/integrations.js";

async function setup(env = {}) {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "user@example.com", passwordHash: "unused", emailVerified: true });
  const other = await repository.createUser({ email: "other@example.com", passwordHash: "unused", emailVerified: true });
  const admin = await repository.createUser({ email: "owner@example.com", passwordHash: "unused", emailVerified: true, role: "admin" });
  const config = loadConfig({ NODE_ENV: "test", ...env });
  const providers = createProviderRegistry(config, { fetchImpl: () => { throw new Error("Discovery must not contact providers"); } });
  const call = (name, body = {}, actor = user) => handleIntegrationFunction({ name, body, user: actor, repository, config, providers });
  return { repository, user, other, admin, config, providers, call };
}

test("integration dispatch rejects unauthenticated access and leaves unknown functions alone", async () => {
  const { call } = await setup();
  assert.equal(await call("unrelated", {}, null), null);
  for (const name of ["get-integration-center", "set-integration-preference", "get-connection-fabric", "get-commercial-control"]) {
    assert.equal((await call(name, {}, null)).status, 401);
  }
});

test("preferences whitelist inputs, remain owner scoped, and never store submitted credentials", async () => {
  const { repository, call, user, other, admin } = await setup();
  const foreign = await repository.createRecord("IntegrationConnection", other, {
    user_id: user.id, provider: "github", connection_mode: "customer_account", status: "connected", api_key: "existing-secret"
  });
  const result = await call("set-integration-preference", {
    provider: " GitHub ", connection_mode: "CUSTOMER_ACCOUNT", id: foreign.id,
    user_id: other.id, owner_id: other.id, status: "connected", api_key: "never-store-this"
  });
  assert.equal(result.status, 200);
  assert.equal(result.payload.data.connection.status, "setup_required");
  assert.equal(result.payload.data.charged, false);
  const own = await repository.listRecords("IntegrationConnection", user);
  assert.equal(own.length, 1);
  assert.equal(own[0].user_id, user.id);
  assert.equal(own[0].owner_id, user.id);
  assert.equal(own[0].api_key, undefined);
  assert.equal((await repository.getRecord("IntegrationConnection", foreign.id, other)).status, "connected");
  const forgedAdminRow = await repository.createRecord("IntegrationConnection", other, {
    user_id: admin.id, provider: "github", connection_mode: "customer_account", status: "connected"
  });
  await call("set-integration-preference", { provider: "github", connection_mode: "not_selected" }, admin);
  assert.equal((await repository.getRecord("IntegrationConnection", forgedAdminRow.id, other)).status, "connected");
  const cleared = await call("set-integration-preference", { provider: "github", connection_mode: "not_selected" });
  assert.equal(cleared.payload.data.connection.id, own[0].id);
  assert.equal(cleared.payload.data.connection.cost_owner, "not_selected");
});

test("unsupported provider and managed selections fail without writes", async () => {
  const { call, repository, user } = await setup();
  for (const body of [{ provider: "unknown", connection_mode: "customer_account" },
    { provider: "github", connection_mode: "iabt_managed" }, { provider: "openai", connection_mode: "ready" }]) {
    assert.equal((await call("set-integration-preference", body)).status, 400);
  }
  assert.deepEqual(await repository.listRecords("IntegrationConnection", user), []);
});

test("integration center does not treat legacy stored connected claims as verified connections", async () => {
  const { call, repository, user } = await setup({ OPENAI_API_KEY: "sk-configured-but-disabled" });
  await repository.createRecord("IntegrationConnection", user, { user_id: user.id, provider: "github",
    connection_mode: "customer_account", status: "connected", scopes: ["admin"], external_account_label: "secret-label" });
  await call("set-integration-preference", { provider: "openai", connection_mode: "iabt_managed" });
  const data = (await call("get-integration-center")).payload.data;
  assert.equal(data.providers.length, 6);
  const github = data.providers.find((row) => row.id === "github");
  assert.equal(github.status, "setup_required");
  assert.equal(github.connection_status, "not_connected");
  assert.equal(github.external_account_label, "");
  assert.deepEqual(github.scopes, []);
  assert.equal(data.providers.find((row) => row.id === "openai").managed_status, "setup_required");
  assert.equal(data.iabt_billing.status, "setup_required");
  assert.ok(!JSON.stringify(data).includes("sk-configured-but-disabled"));
});

test("managed readiness follows the actual registry including commercial and price gates", async () => {
  const { call } = await setup({
    OPENAI_API_KEY: "sk-test-private", IABT_ENABLE_PAID_AI: "true",
    ELEVENLABS_API_KEY: "eleven-private", IABT_ENABLE_PAID_AUDIO: "true", IABT_AUDIO_BILLING_READY: "true",
    IABT_ELEVENLABS_COST_PER_MINUTE_CENTS: "20",
    STRIPE_SECRET_KEY: "sk_test_private", STRIPE_WEBHOOK_SECRET: "whsec_private"
  });
  await call("set-integration-preference", { provider: "openai", connection_mode: "iabt_managed" });
  await call("set-integration-preference", { provider: "elevenlabs", connection_mode: "iabt_managed" });
  const data = (await call("get-integration-center")).payload.data;
  assert.equal(data.providers.find((row) => row.id === "openai").status, "ready");
  assert.equal(data.providers.find((row) => row.id === "elevenlabs").status, "setup_required");
  assert.equal(data.iabt_billing.status, "setup_required", "key and webhook alone do not make checkout ready");
});

test("connection fabric ignores forged manifests and cannot override installed readiness", async () => {
  const { call, repository, user, admin } = await setup();
  await repository.createRecord("ConnectionAdapter", user, { adapter_id: "forged", enabled: true, status: "active", api_key: "private-value" });
  await repository.createRecord("ConnectionAdapter", admin, { adapter_id: "openai-responses", display_name: "Hacked route", enabled: true, status: "active" });
  await repository.createRecord("ConnectionAdapter", admin, { adapter_id: "customer-inventory", display_name: "Inventory gateway", enabled: true,
    status: "active", supported_intents: ["app"], capabilities: ["inventory"], execution_function: "uninstalled-code", token: "private-token" });
  await repository.createRecord("ConnectionAdapter", admin, { adapter_id: "base44-oauth-catalog", enabled: true, status: "active" });
  const data = (await call("get-connection-fabric", { intent: "video", requested_system: "Luma" })).payload.data;
  const { adapters } = data.fabric;
  assert.equal(data.charged, false);
  assert.equal(data.fabric.route_candidates[0], "luma-video");
  assert.equal(adapters.find((row) => row.adapter_id === "openai-responses").status, "setup_required");
  assert.equal(adapters.find((row) => row.adapter_id === "customer-inventory").status, "setup_required");
  assert.equal(adapters.find((row) => row.adapter_id === "customer-inventory").execution_function, "");
  assert.ok(!adapters.some((row) => row.adapter_id === "forged"));
  assert.ok(!JSON.stringify(data).match(/base44|private-value|private-token|uninstalled-code/i));
});

test("commercial snapshot requires admin before reading records", async () => {
  const { call, repository } = await setup();
  repository.listRecords = () => { throw new Error("Unauthorized query"); };
  assert.equal((await call("get-commercial-control")).status, 403);
});

test("commercial snapshot redacts secrets, excludes untrusted approvals and reports incomplete enforcement", async () => {
  const { call, repository, user, admin } = await setup({
    STRIPE_SECRET_KEY: "sk_live_do-not-expose", STRIPE_WEBHOOK_SECRET: "whsec_do-not-expose", IABT_STRIPE_MODE: "live",
    STRIPE_BUILDER_PRICE_ID: "price_b", STRIPE_PRO_PRICE_ID: "price_p", STRIPE_AGENCY_PRICE_ID: "price_a", STRIPE_AI_CREDIT_PACK_PRICE_ID: "price_c"
  });
  const approval = { provider_id: "luma", display_name: "Luma", status: "contract_approved", embedded_use_allowed: true,
    white_label_allowed: true, commercial_output_allowed: true, customer_data_allowed: true, dpa_status: "accepted",
    secret_key: "db-secret", metadata: { token: "nested-secret" } };
  await repository.createRecord("ProviderAgreement", user, approval);
  await repository.createRecord("ProviderAgreement", admin, { ...approval, embedded_use_allowed: false });
  await repository.createRecord("ProviderAgreement", admin, { ...approval, provider_id: "expired", next_review_at: "2000-01-01" });
  await repository.createRecord("ProviderAgreement", admin, { ...approval, provider_id: "reviewed" });
  const now = new Date().toISOString();
  await repository.createRecord("ProviderSpendLedger", admin, { amount_cents: 123, day_key: now.slice(0, 10), month_key: now.slice(0, 7), status: "settled", secret: "ledger-secret" });
  await repository.createRecord("ProviderSpendLedger", admin, { amount_cents: 200, day_key: now.slice(0, 10), month_key: now.slice(0, 7), status: "reversed" });
  await repository.createRecord("PolicyAcceptance", user, { policy_version: "2026-09-01.1" });
  await repository.createRecord("PolicyAcceptance", user, { policy_version: "old" });
  const data = (await call("get-commercial-control", {}, admin)).payload.data;
  assert.equal(data.billing.ready, true);
  assert.equal(data.readiness.stripe_live_ready, true);
  assert.equal(data.readiness.production_launch_ready, false);
  assert.equal(data.commercial.enforcement_ready, false);
  assert.equal(data.commercial.agreements.length, 3);
  assert.equal(data.readiness.approved_provider_agreements, 1);
  assert.equal(data.commercial.spend.accounting_complete, false);
  assert.equal(data.commercial.spend.daily_committed_cents, null);
  assert.equal(data.commercial.spend.monthly_committed_cents, null);
  assert.equal(data.commercial.spend.daily_recorded_cents, 123);
  assert.equal(data.commercial.spend.monthly_recorded_cents, 123);
  assert.equal(data.commercial.spend.lifetime_recorded_cents, 123);
  assert.match(data.commercial.spend.recorded_totals_label, /excludes unrecorded/);
  assert.ok(data.readiness.blocker_codes.includes("standalone_spend_ledger_not_recorded"));
  assert.equal(data.acceptance.recorded_count, 1);
  assert.ok(!JSON.stringify(data).match(/do-not-expose|db-secret|nested-secret|ledger-secret/));
});

test("empty supplier ledger reports unknown spending instead of zero commitments", async () => {
  const { call, admin } = await setup();
  const { commercial } = (await call("get-commercial-control", {}, admin)).payload.data;
  assert.equal(commercial.spend.accounting_complete, false);
  assert.equal(commercial.spend.daily_committed_cents, null);
  assert.equal(commercial.spend.monthly_committed_cents, null);
  assert.equal(commercial.spend.daily_recorded_cents, 0);
  assert.equal(commercial.spend.monthly_recorded_cents, 0);
  assert.equal(commercial.spend.accounting_blocker, "standalone_spend_ledger_not_recorded");
});
