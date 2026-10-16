import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWebAppScripts } from "../src/creation/web-app-script-checks.js";

const html = (body) => `<!doctype html><html lang="en"><head><title>App</title></head><body>${body}</body></html>`;

test("preview-incompatible dialogs and active-markup rendering are rejected for bounded repair", () => {
  for (const source of ["alert('Oops')", "window.confirm('Delete?')", "prompt('Name')", "row.innerHTML = userInput", "row.outerHTML = text", "row.insertAdjacentHTML('beforeend', text)", "document.write(text)"])
    assert.throws(() => validateWebAppScripts(html(`<script>${source}</script>`), { authoringContract: true }), { code: "web_app_preview_api_unsupported" });
  assert.equal(validateWebAppScripts(html("<script>const row = document.createElement('p'); row.textContent = 'Saved';</script>")).inline_classic_scripts_checked, 1);
});

test("inline classic scripts are syntax compiled independently and metadata never claims execution", () => {
  const result = validateWebAppScripts(html(`<script>const x = 1; function add(a, b) { return a + b; }</script><script type="text/javascript">const x = 2;</script>`));
  assert.deepEqual(result, {
    version: 1, method: "bounded_inline_classic_syntax_compilation",
    inline_classic_scripts_checked: 2, inert_data_blocks_skipped: 0, runtime_tested: false
  });
  assert.equal(validateWebAppScripts(html("<h1>No scripts</h1>")).inline_classic_scripts_checked, 0);
  assert.equal(validateWebAppScripts(html('<SCRIPT TYPE="Application/JavaScript; charset=utf-8">void 0;</SCRIPT>')).inline_classic_scripts_checked, 1);
  assert.equal(validateWebAppScripts(html('<script defer nomodule type="text/javascript">void 0;</script>')).inline_classic_scripts_checked, 1);
  assert.equal(validateWebAppScripts(html('<script type>void 0;</script>')).inline_classic_scripts_checked, 1);
});

test("malformed JavaScript fails with a stable public message and no source or parser details", () => {
  assert.throws(() => validateWebAppScripts(html('<script>const PRIVATE_SOURCE_MARKER = ;</script>')), (error) => {
    assert.equal(error.code, "web_app_script_syntax_invalid");
    assert.equal(error.status, 422);
    assert.doesNotMatch(error.message, /PRIVATE_SOURCE_MARKER|Unexpected token|SyntaxError|generated-app-inline/);
    return true;
  });
  assert.throws(() => validateWebAppScripts(html('<script>function incomplete( {</script>')), { code: "web_app_script_syntax_invalid" });
  assert.throws(() => validateWebAppScripts(html('<script>return 1;</script>')), { code: "web_app_script_syntax_invalid" });
});

test("throwing, infinite-looping, network and dynamic-import code is never executed", { timeout: 1000 }, () => {
  const marker = "__iabt_script_syntax_checker_must_not_execute__";
  assert.equal(Object.hasOwn(globalThis, marker), false);
  const result = validateWebAppScripts(html(`<script>globalThis.${marker} = true; throw new Error('must not run'); while (true) {} fetch('https://example.invalid/'); import('node:fs'); process.exit(99);</script>`));
  assert.equal(result.inline_classic_scripts_checked, 1);
  assert.equal(Object.hasOwn(globalThis, marker), false);
});

test("JSON and supported inert data blocks are not parsed as classic JavaScript", () => {
  const result = validateWebAppScripts(html('<script type="application/json">{"items": [1, 2]}</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"Thing"}</script><script type="text/plain">not javascript at all {</script>'));
  assert.equal(result.inline_classic_scripts_checked, 0);
  assert.equal(result.inert_data_blocks_skipped, 3);
  // This checker does not promise that an inert payload is valid JSON.
  assert.equal(validateWebAppScripts(html('<script type="application/json">not valid JSON {</script>')).inert_data_blocks_skipped, 1);
});

test("fake script tags in comments, quoted attributes and text/raw-text elements are inert", () => {
  const result = validateWebAppScripts(html(`<!-- <script>const broken = ;</script> --><div title="<script>not code</script>">Text</div><textarea><script>const broken = ;</script></textarea><title><script>bad {</script></title><style>/* <script>bad {</script> */</style><noscript><script>bad {</script></noscript><script>const actual = true;</script>`));
  assert.equal(result.inline_classic_scripts_checked, 1);
});

test("script raw text closes at the HTML closing tag even inside a JavaScript string", () => {
  assert.throws(() => validateWebAppScripts(html('<script>const text="</script>";</script>')), { code: "web_app_script_syntax_invalid" });
  assert.equal(validateWebAppScripts(html('<script>const text="<\\/script>";</script>')).inline_classic_scripts_checked, 1);
});

test("modules, import maps, encoded type ambiguity and unsupported script types fail explicitly", () => {
  for (const type of ["module", "importmap", "speculationrules", "text/typescript", "text/java&#115;cript"]) {
    assert.throws(() => validateWebAppScripts(html(`<script type="${type}">not even classic JS</script>`)), { code: "web_app_script_type_unsupported", status: 422 });
  }
  assert.throws(() => validateWebAppScripts(html('<script language="vbscript">x = 1</script>')), { code: "web_app_script_type_unsupported" });
});

test("ambiguous comments, malformed tags, legacy escaping and foreign scripts fail conservatively", () => {
  for (const body of [
    '<!--> <script>void 0;</script> -->',
    '<!-- text --!> <script>void 0;</script> -->',
    '<!-- nested <!-- <script>void 0;</script> -->',
    '<!-- never closed',
    '<script/>void 0;</script>',
    '<script type="text/javascript" type="application/json">void 0;</script>',
    '<script>void 0;</script invalid>',
    '<script><!--\nvoid 0;\n// --></script>',
    '<script>const text="<script>";</script>',
    '<textarea>never closed <script>void 0;</script>',
    '<select><style><script>void 0;</script></style></select>',
    '<svg><script>void 0;</script></svg>',
    '<svg data-x=foo/><script>const text="&quot;";</script></svg>',
    '<math><script>void 0;</script></math>',
    '<![CDATA[<script>void 0;</script>]]>',
    '<plaintext><script>void 0;</script>'
  ]) assert.throws(() => validateWebAppScripts(html(body)), { code: "web_app_script_markup_unsupported" });
  assert.equal(validateWebAppScripts(html('<svg viewBox="0 0 10 10"><path d="M0 0" /></svg><script>void 0;</script>')).inline_classic_scripts_checked, 1);
  assert.equal(validateWebAppScripts(html('<svg viewBox="0 0 10 10"/><script>void 0;</script>')).inline_classic_scripts_checked, 1);
});

test("bounds and inline-only script policy are enforced before compilation", () => {
  assert.throws(() => validateWebAppScripts(html('<script src="local.js"></script>')), { code: "web_app_external_dependency" });
  assert.throws(() => validateWebAppScripts(html('<script>void 0;</script>'.repeat(65))), { code: "web_app_too_large" });
  assert.equal(validateWebAppScripts(html('<script></script>'.repeat(64))).inline_classic_scripts_checked, 64);
  assert.throws(() => validateWebAppScripts(" ".repeat(128 * 1024 + 1)), { code: "web_app_too_large" });
  assert.throws(() => validateWebAppScripts("\n".repeat(2000)), { code: "web_app_too_large" });
  assert.throws(() => validateWebAppScripts(null), { code: "web_app_script_markup_unsupported" });
});
