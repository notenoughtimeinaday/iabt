import assert from "node:assert/strict";
import { test } from "node:test";
import { requestedWebAppRequirements, validateWebAppObjective } from "../src/creation/web-app-objective.js";

const html = (body = "App", style = "", head = "") => `<!doctype html><html><head>${head}<style>${style}</style></head><body>${body}</body></html>`;
const ids = (request) => requestedWebAppRequirements(request).map((item) => item.id);
const missing = (request, document) => {
  try { validateWebAppObjective({ request, html: document }); }
  catch (error) {
    assert.equal(error.code, "web_app_requirements_missing");
    return error.missing_requirements;
  }
  return [];
};

test("objective detection does not turn generic product instructions into item CRUD", () => {
  for (const request of [
    "Build a complete calculator app.", "Add dark mode to a calculator.",
    "Remove clutter and complete the website.", "Please note that speed is the priority.",
    "Make a complete app with a professional status page."
  ]) assert.deepEqual(ids(request), [], request);
  assert.deepEqual(ids("Users can add, edit, complete, and delete maintenance tasks."), ["add", "edit", "complete", "delete"]);
  assert.deepEqual(ids("Users can create new records, update existing records and remove selected records."), ["add", "edit", "delete"]);
  assert.deepEqual(ids("Let users mark tasks as done."), ["complete"]);
});

test("explicit negative feature clauses are not promoted into required behavior", () => {
  for (const request of [
    "Build a tracker. Do not add delete controls.", "Do not add tasks, edit tasks or delete tasks.",
    "Build a tracker without search or filtering.", "No JSON import or export is needed.",
    "Avoid notes and priority fields.", "Don't include sample data or empty states.",
    "Never include search or filters.", "Disallow delete tasks.", "Don’t include JSON import."
  ]) assert.deepEqual(ids(request), [], request);
  assert.deepEqual(ids("Build search without filters."), ["search"]);
  assert.deepEqual(ids("No search, but include JSON import and export."), ["json_import", "json_export"]);
  assert.deepEqual(ids("Do not remove existing tasks; include search and filter by status."), ["search", "filter", "status"]);
});

test("JSON requirements retain the operation's own format rather than cross-pairing unrelated formats", () => {
  assert.deepEqual(ids("Import CSV and export JSON."), ["json_export"]);
  assert.deepEqual(ids("Import JSON and export CSV."), ["json_import"]);
  assert.deepEqual(ids("Import and export JSON."), ["json_import", "json_export"]);
  assert.deepEqual(ids("Export and import JSON data."), ["json_import", "json_export"]);
  assert.deepEqual(ids("Include JSON import and JSON export."), ["json_import", "json_export"]);
  assert.deepEqual(ids("Load JSON and export to JSON."), ["json_export"]);
});

test("comment, inert template and non-executable data-script markers cannot satisfy an interaction", () => {
  const request = "Include search, filtering, JSON import and export, and browser storage.";
  const markers = "search filter import JSON.parse( export JSON.stringify( localStorage";
  for (const markup of [
    `<!-- ${markers} -->`, `<template>${markers}</template>`,
    `<noscript>${markers}</noscript>`, `<script type="application/json">${JSON.stringify(markers)}</script>`,
    `<script type=text/plain>${markers}</script>`
  ]) assert.deepEqual(missing(request, html(markup)), ["search", "filters", "browser storage persistence", "JSON import", "JSON export"]);
  assert.deepEqual(missing("Include search", html("<!-- search")), ["search"]);
  assert.deepEqual(missing("Include search", html('<script type="module">const label="search"</script>')), []);
});

test("valid lexical equivalents and intrinsic responsive layouts are not rejected for absent exact labels", () => {
  assert.deepEqual(missing("Edit and remove existing items.", html("<button>Update</button><button>Trash</button>")), []);
  assert.deepEqual(missing("Include sample data.", html('<script>const tasks=[{name:"Pump A"},{name:"Compressor B"}]</script>')), []);
  assert.deepEqual(missing("Use on phone or desktop.", html("App", "main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))}", '<meta name="viewport" content="width=device-width,initial-scale=1">')), []);
  assert.deepEqual(missing("Use on phone or desktop.", html("App", "main{width:min(100%,60rem)}", '<meta name=viewport content="width=device-width,initial-scale=1">')), []);
  assert.deepEqual(missing("Import and export JSON.", html('<button>Load</button><button>Download</button><script>function read(s){return JSON["parse"](s)}function output(x){return JSON [ "stringify" ] (x)}</script>')), []);
});

test("derived review checklists are bounded safe copies and marker evidence is not runtime proof", () => {
  const request = "Add, edit, complete and delete tasks; set equipment name, priority, due date, and notes; search and filter by status; overdue and upcoming; browser storage; import and export JSON; sample data; empty states; phone and desktop.";
  const first = requestedWebAppRequirements(request);
  assert.equal(first.length, 19);
  for (const item of first) {
    assert.deepEqual(Object.keys(item), ["id", "label"]);
    assert.match(item.id, /^[a-z_]{1,40}$/);
    assert.match(item.label, /^[a-zA-Z0-9 -]{1,80}$/);
  }
  first[0].label = "mutated";
  assert.equal(requestedWebAppRequirements(request)[0].label, "add items");
  const result = validateWebAppObjective({ request: "Include search", html: html("<button>Search</button>") });
  assert.deepEqual(result, { version: 1, method: "bounded_lexical_evidence", checked: ["search"], passed: ["search"] });
  assert.equal("runtime_tested" in result, false);
  assert.deepEqual(requestedWebAppRequirements(null), []);
  assert.deepEqual(requestedWebAppRequirements("x".repeat(20_000) + " Include search"), []);
});
