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

const directory = await mkdtemp(join(tmpdir(), "iabt-image-flow-"));
after(async () => rm(directory, { recursive: true, force: true }));

test("an owner image prompt produces a signed quote and a verified private PNG", async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "image-flow-test-secret",
    OPENAI_API_KEY: "configured-test-key",
    OPENAI_IMAGE_MODEL: "gpt-image-1.5",
    IABT_ENABLE_PAID_IMAGES: "true",
    IABT_OPENAI_IMAGE_COST_CENTS: "3"
  });
  const repository = new MemoryRepository();
  const user = await repository.createUser({
    email: "image-owner@example.com",
    passwordHash: "unused",
    emailVerified: true,
    role: "admin"
  });
  await repository.grantCredits({
    ownerId: user.id,
    amount: 1,
    idempotencyKey: "image-opening-balance"
  });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(128)
  ]);
  let calls = 0;
  const providers = createProviderRegistry(config, {
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://api.openai.com/v1/images/generations");
      assert.equal(options.method, "POST");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-image-1.5");
      assert.equal(body.output_format, "png");
      assert.equal(body.quality, "medium");
      return new Response(JSON.stringify({
        created: 1788523200,
        data: [{ b64_json: png.toString("base64") }],
        usage: { total_tokens: 100 }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  const planned = await createCreationPlan({
    repository,
    config,
    providers,
    user,
    requestText:
      "Create an original image of a polished black grand piano in a modern studio, no logos.",
    conversationId: "image-conversation"
  });
  assert.equal(planned.plan.intent, "image");
  assert.equal(planned.plan.render_ready, true);
  assert.equal(planned.plan.job_type, "provider.openai.image");
  assert.equal(planned.plan.commercial_summary.owner_demo_only, true);
  assert.equal(planned.plan.credit_cost, 1);
  assert.equal(planned.plan.provider_cost_cents, 3);

  const started = await executeCreationPlan({
    repository,
    config,
    user,
    body: {
      plan_id: planned.plan.id,
      approved: true,
      pricing_version: planned.plan.pricing_version,
      accepted_total_cents: planned.plan.total_estimated_cost_cents,
      idempotency_key: "approve:" + planned.plan.id
    }
  });
  assert.equal(started.job.status, "queued");

  const storage = new LocalObjectStorage({
    rootDirectory: directory,
    apiOrigin: "http://127.0.0.1:8787",
    signingSecret: config.authSecret
  });
  await storage.ready();
  const worker = createJobWorker({
    repository,
    storage,
    providers,
    config,
    workerId: "image-worker"
  });
  const completed = await worker.runOnce();
  assert.equal(completed.job.status, "succeeded");
  assert.equal(completed.artifacts.length, 1);
  assert.equal(completed.artifact.content_type, "image/png");
  const stored = await storage.read(completed.artifact.storage_key);
  assert.equal(stored.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(calls, 1);

  const account = await repository.getCreditAccount(user.id);
  assert.equal(account.available_credits, 0);
  assert.equal(account.reserved_credits, 0);
});
