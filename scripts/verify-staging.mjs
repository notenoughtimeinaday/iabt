import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const cleanOrigin = (value, name) => {
  const origin = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origin)) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  return origin;
};

const fetchWithTimeout = async (fetchImpl, url, signal) => {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response;
};

const attribute = (tag, name) => {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[1] ?? match[2] ?? match[3] : null;
};

const frontendEntry = async (response, url) => {
  assert.match(response.headers.get("content-type") || "", /text\/html/i, `${url} must deliver HTML`);
  const html = await response.text();
  assert.match(html, /<html|<!doctype/i, `${url} is not an HTML page`);
  const hasRoot = [...html.matchAll(/<div\b([^>]*)>/gi)]
    .some(([, tag]) => attribute(tag, "id") === "root");
  assert.equal(hasRoot, true, `${url} is missing the application root`);
  const entries = [...html.matchAll(/<script\b([^>]*)>/gi)]
    .filter(([, tag]) => attribute(tag, "type")?.toLowerCase() === "module")
    .map(([, tag]) => attribute(tag, "src"))
    .filter(Boolean)
    .map((src) => new URL(src, url).href)
    .sort();
  assert.ok(entries.length > 0, `${url} is missing the application module entry`);
  const routingMarkers = [...html.matchAll(/<meta\b([^>]*)>/gi)]
    .filter(([, tag]) => attribute(tag, "name") === "iabt-routing")
    .map(([, tag]) => attribute(tag, "content"));
  return { entries, routingMarkers };
};

export const verifyStaging = async ({
  apiUrl,
  webUrl,
  fetchImpl = fetch,
  timeoutMs = 10000,
  routingMode = "browser"
}) => {
  const apiOrigin = cleanOrigin(apiUrl, "IABT_STAGING_API_URL");
  const webOrigin = cleanOrigin(webUrl, "IABT_STAGING_WEB_URL");
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60000,
    "Staging timeout must be an integer from 1 to 60000 milliseconds");
  assert.ok(["browser", "hash"].includes(routingMode), "Staging routing mode must be browser or hash");
  // One deadline bounds the complete read-only smoke check, including response
  // bodies. Set 60000 explicitly for a cold service; there are no retry loops.
  const signal = AbortSignal.timeout(timeoutMs);

  const health = await fetchWithTimeout(fetchImpl, apiOrigin + "/healthz", signal).then(
    (response) => response.json()
  );
  assert.equal(health.ok, true);
  assert.equal(health.service, "iabt-standalone");
  assert.equal(health.base44_required, false);

  const readiness = await fetchWithTimeout(fetchImpl, apiOrigin + "/readyz", signal).then(
    (response) => response.json()
  );
  assert.equal(readiness.ok, true);
  assert.equal(readiness.database?.ok, true);
  assert.equal(readiness.object_storage?.ok, true);
  assert.equal(readiness.transactional_email?.ok, true, "Transactional email is not ready");
  assert.equal(readiness.account_access?.ok, true, "Account access is not ready");
  assert.equal(readiness.account_access?.verification_mode, "email", "Staging must use real email verification");
  assert.equal(readiness.migrations?.pending, 0, "Database migrations are pending or unreported");
  assert.ok(Number.isSafeInteger(readiness.migrations?.total) && readiness.migrations.total > 0,
    "Database must report applied migrations");
  assert.notEqual(readiness.migrations?.mode, "development_memory", "Staging must use a persistent migrated database");
  assert.equal(readiness.base44_required, false);

  const settings = await fetchWithTimeout(
    fetchImpl,
    apiOrigin + "/v1/public-settings",
    signal
  ).then((response) => response.json());
  assert.equal(settings.standalone, true);
  assert.equal(settings.public_settings?.operator, "Insured Spending, LLC");

  const rootUrl = webOrigin + "/";
  const rootEntry = await frontendEntry(await fetchWithTimeout(fetchImpl, rootUrl, signal), rootUrl);
  if (routingMode === "hash") {
    assert.deepEqual(rootEntry.routingMarkers, ["hash"],
      'Hash routing requires exactly one HTML marker: <meta name="iabt-routing" content="hash">');
  } else {
    assert.ok(!rootEntry.routingMarkers.includes("hash"), "The frontend uses hash routing; request that verification mode explicitly");
    for (const path of ["/register", "/login"]) {
      const url = webOrigin + path;
      const routeEntry = await frontendEntry(await fetchWithTimeout(fetchImpl, url, signal), url);
      assert.deepEqual(routeEntry.entries, rootEntry.entries, `${path} must serve the same application entry as /`);
    }
  }

  return {
    ok: true,
    api: apiOrigin,
    web: webOrigin,
    version: health.version,
    routing_mode: routingMode,
    route_verification: routingMode === "hash" ? "hash_shell_only" : "direct_navigation_shells",
    browser_execution_verified: false,
    checks: [
      "api_liveness",
      "database_readiness",
      "private_storage_readiness",
      "transactional_email_readiness",
      "account_access_readiness",
      "database_migrations_applied",
      "standalone_public_settings",
      "frontend_delivery",
      ...(routingMode === "hash" ? ["hash_routing_shell_only"] : ["registration_route_delivery", "login_route_delivery"])
    ]
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await verifyStaging({
    apiUrl: process.env.IABT_STAGING_API_URL,
    webUrl: process.env.IABT_STAGING_WEB_URL,
    timeoutMs: process.env.IABT_STAGING_TIMEOUT_MS === undefined
      ? 10000
      : Number(process.env.IABT_STAGING_TIMEOUT_MS),
    routingMode: process.env.IABT_STAGING_ROUTING || "browser"
  });
  console.log(JSON.stringify(result, null, 2));
}
