import assert from "node:assert/strict";
import { test } from "node:test";
import { appReviewSteps } from "../../shared/app-review.js";

test("app review steps stay bounded, inert, copy-safe and explicitly manual", () => {
  const ids = ["edit", "json_import", "json_export", "browser_storage", "edit", "<script>untrusted</script>", "constructor"];
  const original = [...ids];
  const steps = appReviewSteps(ids);
  assert.deepEqual(ids, original);
  assert.equal(steps.length, 7);
  assert.equal(new Set(steps.map((step) => step.id)).size, steps.length);
  assert.match(steps.find((step) => step.id === "edit").text, /without creating a duplicate/);
  assert.match(steps.find((step) => step.id === "json_import").text, /leave existing data unchanged/);
  assert.doesNotMatch(JSON.stringify(steps), /untrusted|constructor|passed|verified/);
  steps[0].text = "Changed";
  assert.notEqual(appReviewSteps()[0].text, "Changed");
  assert.equal(appReviewSteps(null).length, 3);
});
