import assert from "node:assert/strict";
import test from "node:test";
import { verifyStaging } from "../../scripts/verify-staging.mjs";

const jsonResponse = (payload) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

test("staging smoke test verifies independent infrastructure without mutations", async () => {
  const requests = [];
  const result = await verifyStaging({
    apiUrl: "https://api-staging.insuredspending.org/",
    webUrl: "https://staging.insuredspending.org/",
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options?.method || "GET" });
      if (url.endsWith("/healthz")) {
        return jsonResponse({
          ok: true,
          service: "iabt-standalone",
          version: "0.5.0",
          base44_required: false
        });
      }
      if (url.endsWith("/readyz")) {
        return jsonResponse({
          ok: true,
          database: { ok: true },
          object_storage: { ok: true },
          base44_required: false
        });
      }
      if (url.endsWith("/v1/public-settings")) {
        return jsonResponse({
          standalone: true,
          public_settings: { operator: "Insured Spending, LLC" }
        });
      }
      return new Response("<!doctype html><html><body>IABT</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.method === "GET"));
});

test("staging smoke test fails when storage readiness fails", async () => {
  await assert.rejects(
    verifyStaging({
      apiUrl: "https://api.example.test",
      webUrl: "https://web.example.test",
      fetchImpl: async (url) => {
        if (url.endsWith("/healthz")) {
          return jsonResponse({
            ok: true,
            service: "iabt-standalone",
            base44_required: false
          });
        }
        if (url.endsWith("/readyz")) {
          return jsonResponse({
            ok: true,
            database: { ok: true },
            object_storage: { ok: false },
            base44_required: false
          });
        }
        return jsonResponse({});
      }
    }),
    /false/
  );
});
