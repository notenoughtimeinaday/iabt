import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const cleanOrigin = (value, name) => {
  const origin = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(origin)) {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  return origin;
};

const fetchWithTimeout = async (fetchImpl, url, options = {}) => {
  const response = await fetchImpl(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response;
};

export const verifyStaging = async ({
  apiUrl,
  webUrl,
  fetchImpl = fetch
}) => {
  const apiOrigin = cleanOrigin(apiUrl, "IABT_STAGING_API_URL");
  const webOrigin = cleanOrigin(webUrl, "IABT_STAGING_WEB_URL");

  const health = await fetchWithTimeout(fetchImpl, apiOrigin + "/healthz").then(
    (response) => response.json()
  );
  assert.equal(health.ok, true);
  assert.equal(health.service, "iabt-standalone");
  assert.equal(health.base44_required, false);

  const readiness = await fetchWithTimeout(fetchImpl, apiOrigin + "/readyz").then(
    (response) => response.json()
  );
  assert.equal(readiness.ok, true);
  assert.equal(readiness.database?.ok, true);
  assert.equal(readiness.object_storage?.ok, true);
  assert.equal(readiness.base44_required, false);

  const settings = await fetchWithTimeout(
    fetchImpl,
    apiOrigin + "/v1/public-settings"
  ).then((response) => response.json());
  assert.equal(settings.standalone, true);
  assert.equal(settings.public_settings?.operator, "Insured Spending, LLC");

  const web = await fetchWithTimeout(fetchImpl, webOrigin + "/");
  const html = await web.text();
  assert.match(html, /<html|<!doctype/i);

  return {
    ok: true,
    api: apiOrigin,
    web: webOrigin,
    version: health.version,
    checks: [
      "api_liveness",
      "database_readiness",
      "private_storage_readiness",
      "standalone_public_settings",
      "frontend_delivery"
    ]
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await verifyStaging({
    apiUrl: process.env.IABT_STAGING_API_URL,
    webUrl: process.env.IABT_STAGING_WEB_URL
  });
  console.log(JSON.stringify(result, null, 2));
}
