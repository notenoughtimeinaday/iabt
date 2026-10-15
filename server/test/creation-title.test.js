import assert from "node:assert/strict";
import { test } from "node:test";
import { createCreationPlan } from "../src/creation/planner.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/memory-repository.js";
import { createProviderRegistry } from "../src/providers/provider-registry.js";

test("custom app quotes keep request-specific names instead of inferring a storefront from shop or storage", async () => {
  const repository = new MemoryRepository();
  const user = await repository.createUser({ email: "quote-titles@example.test", passwordHash: "unused", emailVerified: true });
  const config = loadConfig({ NODE_ENV: "test", IABT_AUTH_SECRET: "creation-title-test-only", OPENAI_API_KEY: "not-a-live-key", IABT_ENABLE_PAID_AI: "true", IABT_ENABLE_ORCHESTRATION: "true", IABT_ORCHESTRATION_BUDGET_ACCEPTED: "true", IABT_OPENAI_RESPONSE_COST_CENTS: "2", IABT_ORCHESTRATION_BUDGET_CENTS: "12" });
  let providerCalls = 0;
  const providers = createProviderRegistry(config, { fetchImpl: async () => { providerCalls += 1; throw new Error("Quote naming must not call a provider"); } });
  const requests = [
    ["Build a polished, self-contained equipment maintenance tracker for a small shop. Users can add, edit, complete and delete tasks.", "Equipment maintenance tracker"],
    ["Build a shop equipment tracker with browser storage.", "Shop equipment tracker"],
    ["Create a workshop inventory app that stores notes.", "Workshop inventory app"],
    ["Build a piano practice app for violin students.", "Piano practice app"],
    ["Please create a responsive website for a local repair shop.", "Website for a local repair shop"],
    ['Build a notes app with a field named "Priority".', "Notes app"],
    ['Build an app called "Shop Floor" with equipment maintenance tasks.', "Shop Floor"],
    ['Create a website named “North Shop” for my business.', "North Shop"],
    ["Create a task-list starter", "My task list"],
    ["Create a storefront demo", "Storefront demo"],
    ["Create a piano starter", "Keyboard Piano"]
  ];
  for (const [requestText, expected] of requests) {
    const { plan } = await createCreationPlan({ repository, config, providers, user, requestText });
    assert.equal(plan.title, expected, requestText);
    assert.equal(plan.status, "quoted");
  }
  assert.equal(providerCalls, 0);
  assert.equal((await repository.listJobs(user)).length, 0);
  assert.equal((await repository.getCreditAccount(user.id)).reserved_credits, 0);
});
