import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import {
  createCreationPlan,
  executeCreationPlan,
  inferCreationIntent
} from "../src/creation/planner.js";
import { runClaimedJob } from "../src/job-runner.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";
import { LocalObjectStorage } from "../src/storage/local-storage.js";

test("prompt-first inference recognizes specialized standalone deliverables", () => {
  assert.equal(inferCreationIntent("Create a Node API script"), "code");
  assert.equal(inferCreationIntent("Make a design system and wireframe"), "design");
  assert.equal(inferCreationIntent("Prepare CNC G-code for this part"), "gcode_simulation");
  assert.equal(inferCreationIntent("Automate a webhook workflow"), "automation");
});

test("specialized plans execute into durable, truthfully bounded artifacts", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "iabt-specialized-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const config = loadConfig({
    NODE_ENV: "test",
    IABT_AUTH_SECRET: "specialized-test-secret",
    IABT_API_ORIGIN: "http://127.0.0.1:8787"
  });
  const repository = new MemoryRepository();
  const user = await repository.createUser({
    email: "owner@example.test",
    passwordHash: "unused",
    role: "admin",
    emailVerified: true
  });
  await repository.grantCredits({
    ownerId: user.id,
    amount: 20,
    idempotencyKey: "specialized-test-grant"
  });
  const storage = new LocalObjectStorage({
    rootDirectory: directory,
    apiOrigin: config.apiOrigin,
    signingSecret: config.authSecret
  });
  await storage.ready();
  const providers = createProviderRegistry(config, {
    fetchImpl: async () => {
      throw new Error("Specialized deterministic jobs must not use the network");
    }
  });

  const cases = [
    {
      prompt: "Create a Node API script for an inventory service",
      intent: "code",
      jobType: "creation.code",
      artifactCount: 2
    },
    {
      prompt: "Create a design system and wireframe for a calm customer portal",
      intent: "design",
      jobType: "creation.design",
      artifactCount: 3
    },
    {
      prompt: "Prepare CNC G-code for a mounting plate",
      intent: "gcode_simulation",
      jobType: "creation.gcode-simulation",
      artifactCount: 3
    },
    {
      prompt: "Automate a webhook workflow that sends a billing alert",
      intent: "automation",
      jobType: "creation.automation",
      artifactCount: 3
    }
  ];

  for (const item of cases) {
    const planned = await createCreationPlan({
      repository,
      config,
      providers,
      user,
      requestText: item.prompt
    });
    assert.equal(planned.plan.intent, item.intent);
    assert.equal(planned.plan.job_type, item.jobType);
    assert.equal(planned.plan.render_ready, true);

    const execution = await executeCreationPlan({
      repository,
      config,
      user,
      body: {
        plan_id: planned.plan.id,
        approved: true,
        pricing_version: planned.plan.pricing_version,
        accepted_total_cents: planned.plan.total_estimated_cost_cents
      }
    });
    const claimed = await repository.claimNextJob({
      workerId: "specialized-test-worker"
    });
    assert.equal(claimed.id, execution.job.id);

    const completed = await runClaimedJob({
      job: claimed,
      workerId: "specialized-test-worker",
      repository,
      storage,
      providers,
      pollDelayMs: 0
    });
    assert.equal(completed.job.status, "succeeded");
    assert.equal(completed.artifacts.length, item.artifactCount);
  }

  const allJobs = await repository.listJobs(user, { limit: 20 });
  const gcodeJob = allJobs.find((job) => job.job_type === "creation.gcode-simulation");
  assert.ok(gcodeJob);
  assert.ok(
    gcodeJob.output.artifact_manifest.every(
      (entry) => !/\.gcode$|\.nc$/i.test(entry.name)
    ),
    "simulation-only flow must not claim executable machine code"
  );

  const automationJob = allJobs.find((job) => job.job_type === "creation.automation");
  const runbookEntry = automationJob.output.artifact_manifest.find((entry) =>
    /Automation Runbook\.json$/.test(entry.name)
  );
  const runbookRecord = await repository.getStoredObject(runbookEntry.id, user);
  const runbook = JSON.parse(
    (await storage.read(runbookRecord.storage_key)).toString("utf8")
  );
  assert.equal(runbook.enabled, false);
  assert.equal(runbook.mode, "dry_run");
});
