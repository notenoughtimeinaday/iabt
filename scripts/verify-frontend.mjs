import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createFrontendConfig } from "./frontend-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const apiUrl = "https://independent-api.example.test";
const standaloneConfig = () => createFrontendConfig({ root, env: { VITE_IABT_API_URL: apiUrl } });
const buildOptions = { configFile: false, envFile: false, logLevel: "error", build: { write: false } };

test("standalone is the default and invalid API origins fail before building", async () => {
  const config = await standaloneConfig();
  assert.equal(config.define["import.meta.env.VITE_IABT_BACKEND"], '"standalone"');
  for (const value of [undefined, "", "/api", "not-a-url", "ftp://example.test", "https://user:secret@example.test", "https://example.test/v1", "https://example.test?key=secret", "https://example.test/#token", "https://old.base44.app"]) {
    await assert.rejects(createFrontendConfig({ root, env: { VITE_IABT_API_URL: value } }), /VITE_IABT_API_URL must be/);
  }
  await assert.rejects(createFrontendConfig({ root, env: { VITE_IABT_BACKEND: "typo" } }), /Unsupported VITE_IABT_BACKEND/);
  const local = await createFrontendConfig({ root, env: { VITE_IABT_API_URL: " http://localhost:8787/ " } });
  assert.equal(local.define["import.meta.env.VITE_IABT_API_URL"], '"http://localhost:8787"');
});

test("the real standalone frontend excludes the Base44 SDK, bootstrap, consent, and scripts", async () => {
  const config = await createFrontendConfig({
    root,
    env: {
      VITE_IABT_API_URL: apiUrl,
      // Leftover legacy settings must not select or initialize Base44.
      VITE_BASE44_APP_ID: "old-app",
      VITE_BASE44_APP_BASE_URL: "https://old.base44.app",
    },
  });
  const result = await build({ ...config, ...buildOptions });
  const chunks = result.output.filter((item) => item.type === "chunk");
  const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules)).join("\n");
  assert.match(modules, /src\/api\/standaloneClient\.js/);
  assert.match(modules, /src\/pages\/OAuthConsent\.jsx/);
  assert.doesNotMatch(modules, /@base44|src\/legacy\/|base44Client\.js|app-params\.js/);
  const code = chunks.map((chunk) => chunk.code).join("\n");
  assert.ok(code.includes(apiUrl));
  assert.doesNotMatch(code, /\/api\/apps\/|\/api\/app-logs\/|base44_access_token/);
  const html = result.output.find((item) => item.fileName === "index.html").source;
  assert.doesNotMatch(String(html), /base44|app-logs|trackPageView/i);
});

test("the build refuses a newly introduced legacy bootstrap import", async () => {
  const config = await standaloneConfig();
  await assert.rejects(build({
    ...config,
    ...buildOptions,
    build: { write: false, rollupOptions: { input: root + "src/lib/app-params.js" } },
  }), /Standalone frontend cannot load a Base44 module/);
});

test("the build refuses injected legacy analytics", async () => {
  const config = await standaloneConfig();
  await assert.rejects(build({
    ...config,
    ...buildOptions,
    plugins: [...config.plugins, {
      name: "regression-fixture",
      resolveId(id) { if (id === "regression-fixture") return id; },
      load(id) { if (id === "regression-fixture") return 'fetch("/api/app-logs/old-app/log-user-in-app/home")'; },
    }],
    build: { write: false, rollupOptions: { input: "regression-fixture" } },
  }), /Base44 runtime code found in standalone output/);
});

test("explicit legacy builds still select the legacy client and consent page", async () => {
  const config = await createFrontendConfig({ root, env: { VITE_IABT_BACKEND: "base44" } });
  const result = await build({ ...config, ...buildOptions });
  const modules = result.output.filter((item) => item.type === "chunk")
    .flatMap((chunk) => Object.keys(chunk.modules)).join("\n");
  assert.match(modules, /src\/legacy\/iabtClient\.js/);
  assert.match(modules, /src\/legacy\/OAuthConsent\.jsx/);
  assert.match(modules, /node_modules\/@base44\/sdk\//);
  assert.doesNotMatch(modules, /src\/api\/standaloneClient\.js/);
});
