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
          version: "0.6.0",
          base44_required: false
        });
      }
      if (url.endsWith("/readyz")) {
        return jsonResponse({
          ok: true,
          database: { ok: true },
          object_storage: { ok: true },
          transactional_email: { ok: true },
          account_access: { ok: true, verification_mode: "email" },
          migrations: { total: 4, pending: 0 },
          base44_required: false
        });
      }
      if (url.endsWith("/v1/public-settings")) {
        return jsonResponse({
          standalone: true,
          public_settings: { operator: "Insured Spending, LLC" }
        });
      }
      return new Response('<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-123.js"></script></body></html>', {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 6);
  assert.ok(requests.every((request) => request.method === "GET"));
  assert.ok(requests.some((request) => request.url.endsWith("/register")));
  assert.ok(requests.some((request) => request.url.endsWith("/login")));
  assert.ok(result.checks.includes("transactional_email_readiness"));
  assert.ok(result.checks.includes("database_migrations_applied"));
});

const readinessFixture = () => ({
  ok: true, database: { ok: true }, object_storage: { ok: true },
  transactional_email: { ok: true }, account_access: { ok: true, verification_mode: "email" },
  migrations: { total: 4, pending: 0 }, base44_required: false
});
const htmlFixture = (entry = "/assets/index-123.js", routingMode = "browser") => new Response(
  `<!doctype html><html><head><meta name="iabt-routing" content="${routingMode}"></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`,
  { headers: { "content-type": "text/html" } }
);
const smokeFixture = ({ readiness = readinessFixture(), web = () => htmlFixture() } = {}) => ({
  apiUrl: "https://api.example.test", webUrl: "https://web.example.test",
  fetchImpl: async (url) => {
    if (url.endsWith("/healthz")) return jsonResponse({ ok: true, service: "iabt-standalone", version: "0.7.0", base44_required: false });
    if (url.endsWith("/readyz")) return jsonResponse(readiness);
    if (url.endsWith("/v1/public-settings")) return jsonResponse({ standalone: true, public_settings: { operator: "Insured Spending, LLC" } });
    return web(url);
  }
});

test("staging rejects missing transactional email and development-only account access", async () => {
  for (const email of [undefined, { ok: false }]) {
    const readiness = readinessFixture();
    readiness.transactional_email = email;
    await assert.rejects(verifyStaging(smokeFixture({ readiness })), /Transactional email is not ready/);
  }
  const readiness = readinessFixture();
  readiness.account_access.verification_mode = "development_otp";
  await assert.rejects(verifyStaging(smokeFixture({ readiness })), /real email verification/);
});

test("staging rejects pending, missing and development-memory migrations", async () => {
  for (const migrations of [undefined, { total: 4, pending: 1 }, { total: 0, pending: 0 }, { total: 4, pending: 0, mode: "development_memory" }]) {
    const readiness = { ...readinessFixture(), migrations };
    await assert.rejects(verifyStaging(smokeFixture({ readiness })), /migrations|migrated database/);
  }
});

test("registration and login must survive direct navigation without a 404", async () => {
  for (const route of ["/register", "/login"]) {
    await assert.rejects(verifyStaging(smokeFixture({
      web: (url) => url.endsWith(route) ? new Response("Not Found", { status: 404 }) : htmlFixture()
    })), /returned HTTP 404/);
  }
});

test("a 200 error page and a different application shell cannot pass route delivery", async () => {
  for (const response of [
    () => new Response("<!doctype html><html>Not Found</html>", { headers: { "content-type": "text/html" } }),
    () => htmlFixture("/assets/other-application.js")
  ]) {
    await assert.rejects(verifyStaging(smokeFixture({ web: (url) => url.endsWith("/register") ? response() : htmlFixture() })),
      /application root|same application entry/);
  }
});

test("staging timeout is explicitly bounded and one deadline is shared without retries", async () => {
  for (const timeoutMs of [0, 60001, NaN, 1.5]) {
    await assert.rejects(verifyStaging({ ...smokeFixture(), timeoutMs }), /1 to 60000/);
  }
  const fixture = smokeFixture();
  const signals = [];
  await verifyStaging({ ...fixture, timeoutMs: 60000, fetchImpl: (url, options) => {
    signals.push(options.signal);
    return fixture.fetchImpl(url, options);
  } });
  assert.equal(signals.length, 6);
  assert.ok(signals.every((signal) => signal === signals[0]));
  assert.equal(signals[0].aborted, false);

  let attempts = 0;
  await assert.rejects(verifyStaging({ ...fixture, timeoutMs: 1, fetchImpl: async (_url, { signal }) => {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    signal.throwIfAborted();
  } }), { name: "TimeoutError" });
  assert.equal(attempts, 1);
});

test("explicit hash mode verifies only a declared hash shell and reports browser QA as outstanding", async () => {
  const urls = [];
  const fixture = smokeFixture({ web: () => htmlFixture("/assets/index-123.js", "hash") });
  const result = await verifyStaging({ ...fixture, routingMode: "hash", fetchImpl: (url, options) => {
    urls.push(url);
    return fixture.fetchImpl(url, options);
  } });
  assert.equal(result.route_verification, "hash_shell_only");
  assert.equal(result.browser_execution_verified, false);
  assert.ok(result.checks.includes("hash_routing_shell_only"));
  assert.equal(result.checks.includes("registration_route_delivery"), false);
  assert.equal(result.checks.includes("login_route_delivery"), false);
  assert.equal(urls.length, 4);
  assert.equal(urls.some((url) => url.endsWith("/register") || url.endsWith("/login")), false);
});

test("hash routing cannot silently weaken a browser-mode check or accept an undeclared shell", async () => {
  await assert.rejects(verifyStaging({ ...smokeFixture(), routingMode: "hash" }), /Hash routing requires exactly one HTML marker/);
  await assert.rejects(verifyStaging(smokeFixture({ web: () => htmlFixture("/assets/index-123.js", "hash") })), /request that verification mode explicitly/);
  await assert.rejects(verifyStaging({ ...smokeFixture(), routingMode: "unknown" }), /mode must be browser or hash/);
  const readiness = readinessFixture();
  readiness.transactional_email.ok = false;
  await assert.rejects(verifyStaging({ ...smokeFixture({ readiness, web: () => htmlFixture("/assets/index-123.js", "hash") }), routingMode: "hash" }), /Transactional email is not ready/);
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
