import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const temp = await mkdtemp(path.join(tmpdir(), "iabt-creation-"));
const outfile = path.join(temp, "deterministic-app.mjs");
await build({
  entryPoints: ["base44/shared/deterministic-app.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  logLevel: "silent",
});
const fallback = await import(pathToFileURL(outfile).href + "?v=" + Date.now());

const pianoRequest = "Create a piano app that uses the computer keyboard as piano keys, shows the keyboard, and has octave controls.";
const pianoDefinition = fallback.createFallbackAppDefinition(pianoRequest, {});
const piano = fallback.createFallbackInteractiveApp(pianoRequest, {}, pianoDefinition);
assert.equal(piano.generation_strategy, "iabt_deterministic_recovery");
assert.match(piano.preview_html, /AudioContext/);
assert.match(piano.preview_html, /keydown/);
assert.match(piano.preview_html, /keyup/);
assert.match(piano.preview_html, /Octave/);
assert.match(piano.preview_html, /visibilitychange/);
assert.ok(piano.test_cases.length >= 3);

const storeRequest = "Create an advertising website for IABT that can sell merchandise with a product catalog, shopping cart, quantities, totals, and Stripe-ready checkout.";
const storeDefinition = fallback.createFallbackAppDefinition(storeRequest, {});
const store = fallback.createFallbackInteractiveApp(storeRequest, {}, storeDefinition);
assert.ok(storeDefinition.pages.some((page) => page.route === "/store"));
assert.match(store.preview_html, /Add to cart/);
assert.match(store.preview_html, /data-change/);
assert.match(store.preview_html, /Subtotal/);
assert.match(store.preview_html, /Stripe Checkout/);
assert.ok(store.test_cases.length >= 3);

const source = await readFile("base44/shared/production-artifacts.ts", "utf8");
assert.match(source, /product_catalog_implemented/);
assert.match(source, /requested_audio_engine_implemented/);
assert.match(source, /generation_strategy/);

console.log("IABT deterministic app recovery verified: piano and commerce golden paths passed.");
