import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const routingSource = (await readFile(new URL("../../src/lib/routing.js", import.meta.url), "utf8"))
  .replace("import.meta.env?.VITE_IABT_ROUTING", '"hash"');
const routingUrl = `data:text/javascript;base64,${Buffer.from(routingSource).toString("base64")}`;
const routing = await import(routingUrl);
const returnToSource = (await readFile(new URL("../../src/lib/authReturnTo.js", import.meta.url), "utf8"))
  .replace('"./routing.js"', JSON.stringify(routingUrl));
const { safeReturnTo } = await import(`data:text/javascript;base64,${Buffer.from(returnToSource).toString("base64")}`);
const origin = "https://app.example.test";

test("hash links keep deep routes and nested anchors in the root document", () => {
  const href = routing.appHref("/projects/abc?tab=files#details", { origin });
  const externalUrl = new URL(href, origin);
  assert.equal(externalUrl.pathname, "/");
  assert.equal(externalUrl.search, "");
  assert.equal(externalUrl.hash, "#/projects/abc?tab=files#details");
  const route = routing.getAppLocation(externalUrl);
  assert.equal(route.pathname, "/projects/abc");
  assert.equal(route.searchParams.get("tab"), "files");
  assert.equal(route.hash, "#details");
  assert.equal(routing.appHref("/login", { origin, mode: "browser" }), "/login");
});

test("hash sign-in return paths retain project context and remove session/bootstrap injection", () => {
  const raw = origin + "/#/projects/abc?tab=files&access_token=attack&app_base_url=https://evil.example";
  const login = new URL(origin + "/#/login?returnTo=" + encodeURIComponent(raw));
  assert.equal(safeReturnTo(login), "/projects/abc?tab=files");
  for (const hostile of ["https://evil.example/", "//evil.example", "/\\evil.example", "/.//evil.example", origin + "/#//evil.example"]) {
    assert.equal(safeReturnTo(new URL(origin + "/#/login?returnTo=" + encodeURIComponent(hostile))), "/");
  }
});

test("root Stripe returns survive routing normalization and subsequent sign-in redirect", () => {
  const replacements = [];
  const browser = {
    location: new URL(origin + "/?billing=credits_success&session_id=cs_test_fixture"),
    history: { state: null, replaceState: (_state, _title, target) => replacements.push(target) }
  };
  routing.normalizeRoutingLocation(browser);
  const normalized = new URL(replacements[0], origin);
  assert.equal(normalized.pathname, "/");
  const route = routing.getAppLocation(normalized);
  assert.equal(route.searchParams.get("billing"), "credits_success");
  const login = new URL(origin + "/#/login?returnTo=" + encodeURIComponent(route.pathname + route.search));
  assert.equal(safeReturnTo(login), "/?billing=credits_success&session_id=cs_test_fixture");
});
