import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  createCreationPlan,
  executeCreationPlan
} from "../src/creation/planner.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";
import { createJobWorker } from "../src/worker.js";

const directory = await mkdtemp(join(tmpdir(), "iabt-creation-flow-"));
after(async () => rm(directory, { recursive: true, force: true }));

const config = loadConfig({
  NODE_ENV: "test",
  IABT_AUTH_SECRET: "creation-flow-test-secret",
  IABT_JOB_LEASE_MS: "1000"
});
const repository = new MemoryRepository();
const storage = new LocalObjectStorage({
  rootDirectory: directory,
  apiOrigin: "http://127.0.0.1:8787",
  signingSecret: config.authSecret
});
await storage.ready();
let providerCalls = 0;
const providers = createProviderRegistry(config, {
  fetchImpl: async () => {
    providerCalls += 1;
    throw new Error("Deterministic creation must not call a paid provider");
  }
});
const worker = createJobWorker({
  repository,
  storage,
  providers,
  config,
  workerId: "creation-flow-worker"
});
const user = await repository.createUser({
  email: "creator@example.com",
  passwordHash: "unused",
  emailVerified: true
});
await repository.grantCredits({
  ownerId: user.id,
  amount: 3,
  idempotencyKey: "migration-opening-balance"
});

const approve = (plan) => ({
  plan_id: plan.id,
  approved: true,
  pricing_version: plan.pricing_version,
  accepted_total_cents: plan.total_estimated_cost_cents,
  idempotency_key: "approve:" + plan.id + ":" + plan.pricing_version
});

test("plain piano prompt becomes an exact quote and four verified artifacts", async () => {
  const planned = await createCreationPlan({
    repository,
    config,
    providers,
    user,
    requestText:
      "Create a piano app that uses the computer keyboard as piano keys, shows the keyboard, and has octave controls.",
    conversationId: "piano-conversation"
  });
  assert.equal(planned.plan.intent, "app");
  assert.equal(planned.plan.title, "Keyboard Piano");
  assert.equal(planned.plan.render_ready, true);
  assert.equal(planned.plan.deliverables.length, 4);

  await assert.rejects(
    executeCreationPlan({
      repository,
      config,
      user,
      body: { ...approve(planned.plan), pricing_version: "stale-version" }
    }),
    (error) => error.code === "quote_mismatch"
  );
  let account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 3);
  assert.equal(account.reserved_credits, 0);

  const started = await executeCreationPlan({
    repository,
    config,
    user,
    body: approve(planned.plan)
  });
  assert.equal(started.ok, true);
  assert.equal(started.job.status, "queued");
  account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 2);
  assert.equal(account.reserved_credits, 1);

  const duplicate = await executeCreationPlan({
    repository,
    config,
    user,
    body: approve(planned.plan)
  });
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.job.id, started.job.id);

  const completed = await worker.runOnce();
  assert.equal(completed.job.status, "succeeded");
  assert.equal(completed.artifacts.length, 4);
  assert.equal(completed.job.output.artifact_manifest.length, 4);
  assert.equal(providerCalls, 0);

  const preview = completed.artifacts.find((artifact) =>
    artifact.original_name.endsWith("Interactive Preview.html")
  );
  const previewHtml = (await storage.read(preview.storage_key)).toString("utf8");
  assert.match(previewHtml, /AudioContext/);
  assert.match(previewHtml, /keydown/);
  assert.match(previewHtml, /keyup/);
  assert.match(previewHtml, /Octave/);

  const sourceZip = completed.artifacts.find((artifact) =>
    artifact.original_name.endsWith("-source.zip")
  );
  const zip = await storage.read(sourceZip.storage_key);
  assert.equal(zip.subarray(0, 4).toString("hex"), "504b0304");

  const finalPlan = await repository.getRecord("CreationPlan", planned.plan.id, user);
  assert.equal(finalPlan.status, "completed");
  account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 2);
  assert.equal(account.reserved_credits, 0);
});

test("storefront prompt is inferred without a mode selector and produces a working cart preview", async () => {
  const planned = await createCreationPlan({
    repository,
    config,
    providers,
    user,
    requestText:
      "I need an advertising website for IABT that sells merchandise with products, a cart, quantities, totals, and Stripe-ready checkout.",
    conversationId: "store-conversation"
  });
  assert.equal(planned.plan.intent, "website");
  const started = await executeCreationPlan({
    repository,
    config,
    user,
    body: approve(planned.plan)
  });
  assert.equal(started.job.status, "queued");

  const completed = await worker.runOnce();
  assert.equal(completed.job.status, "succeeded");
  const preview = completed.artifacts.find((artifact) =>
    artifact.original_name.endsWith("Interactive Preview.html")
  );
  const html = (await storage.read(preview.storage_key)).toString("utf8");
  assert.match(html, /Add to cart/);
  assert.match(html, /data-change/);
  assert.match(html, /Subtotal/);
  assert.match(html, /Stripe Checkout/);
  assert.equal(providerCalls, 0);

  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 1);
  assert.equal(account.reserved_credits, 0);
});
