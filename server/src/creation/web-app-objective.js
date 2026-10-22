const includes = (pattern) => (text) => pattern.test(text);
const all = (...patterns) => (text) => patterns.every((pattern) => pattern.test(text));
const actionWords = "(?:add|create|insert|edit|modify|update|complete|finish|delete|remove)";
const itemWords = "(?:items?|tasks?|shifts?|records?|entries|rows?|notes?|products?|contacts?|events?|transactions?|expenses?|equipment|appointments?|projects?|habits?|reminders?|customers?|orders?|recipes?|bookmarks?)";
const itemModifiers = "(?:(?:a|an|the|new|existing|maintenance|selected|saved|inventory|personal)\\s+){0,5}";
// A generic request to complete an app, add dark mode or remove clutter is not
// a request for item CRUD. Coordinated verbs may share their final item noun.
const itemAction = (verbs) => includes(new RegExp(`\\b(?:${verbs})\\b(?:(?:\\s*,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+)${actionWords}\\b)*\\s+${itemModifiers}${itemWords}\\b`, "i"));
const fieldRequest = (name) => includes(new RegExp(`\\b(?:set|assign|choose|select|include|enter|fields?|with|by)\\b[^.;]{0,100}\\b(?:${name})\\b`, "i"));
const jsonOperation = (operation, paired) => includes(new RegExp(`\\b${operation}(?:ing)?\\s+(?:(?:and|or)\\s+${paired}(?:ing)?\\s+)?(?:(?:data|files?)\\s+)?(?:(?:as|in|from|to)\\s+)?JSON\\b|\\bJSON\\s+(?:(?:data|files?)\\s+)?(?:${paired}(?:ing)?\\s+(?:and|or)\\s+)?${operation}(?:ing)?\\b`, "i"));
// Removing a feature is not a request to keep it. Still recognize item deletion
// ("remove tasks") as an interaction. Ambiguous removal prose is under-detected.
const featureRemoval = new RegExp(`\\b(?:remove|delete|drop|replace)\\b(?!\\s+${itemModifiers}${itemWords}\\b)`, "i");

// Prefer under-detection over forcing an unwanted feature into a paid result.
// This deliberately does not interpret arbitrary prose or resolve coreference.
function positiveClauses(request) {
  return String(typeof request === "string" ? request : "").slice(0, 20_000).replaceAll("’", "'")
    .split(/[.!?;\n]+|\b(?:but|however|instead)\b/i)
    .map((clause) => clause.split(/\b(?:without|avoid\w*|exclud\w*|omit\w*|disabl\w*|disallow\w*|forbid\w*|never|cannot|can't|shouldn't|mustn't|don't|do\s+not|doesn't|does\s+not|not|no)\b/i, 1)[0])
    .map((clause) => clause.split(featureRemoval, 1)[0])
    .filter(Boolean);
}

const REQUIREMENTS = Object.freeze([
  { id: "add", label: "add items", requested: itemAction("add|create|insert"), evidenced: includes(/\b(?:add|create|new|insert)\b/i) },
  { id: "edit", label: "edit existing items", requested: itemAction("edit|modify|update"), evidenced: includes(/\b(?:edit|editing|editable|contenteditable|modify|update|rename)\b/i) },
  { id: "complete", label: "complete items", requested: (text) => itemAction("complete|finish")(text) || /\bmark(?:ing)?\s+(?:(?:items?|tasks?)\s+)?(?:as\s+)?done\b|\bmark\s+[^.;]{1,50}\s+(?:as\s+)?(?:complete|done)\b/i.test(text), evidenced: includes(/\b(?:complete|completed|done|finished)\b/i) },
  { id: "delete", label: "delete items", requested: itemAction("delete|remove"), evidenced: includes(/\b(?:delete|remove|trash)\b/i) },
  { id: "equipment_name", label: "equipment name", requested: includes(/\bequipment\s+name\b/i), evidenced: includes(/\bequipment\s+name\b/i) },
  { id: "priority", label: "priority", requested: fieldRequest("priorit(?:y|ies)"), evidenced: includes(/\bpriorit(?:y|ies)\b/i) },
  { id: "due_date", label: "due date", requested: includes(/\bdue\s+date\b/i), evidenced: includes(/\bdue\s+date\b|\bdeadline\b/i) },
  { id: "notes", label: "notes", requested: fieldRequest("notes?"), evidenced: includes(/\b(?:notes?|memo)\b/i) },
  { id: "search", label: "search", requested: includes(/\bsearch(?:able|ing)?\b/i), evidenced: includes(/\bsearch\b/i) },
  { id: "hour_totals", label: "planned and completed hour totals", requested: all(/\btotals?\b/i, /\bplanned\b/i, /\bcompleted\s+hours\b/i), evidenced: all(/\bplanned\b/i, /\bcompleted\b/i, /\b(?:hours|totals?)\b/i, /\.\s*reduce\s*\(|\+=/) },
  { id: "filter", label: "filters", requested: includes(/\bfilter(?:s|ed|ing)?\b/i), evidenced: includes(/\bfilter(?:s|ed|ing)?\b/i) },
  { id: "status", label: "status", requested: includes(/\b(?:set|track|assign|choose|select|by|fields?)\b[^.;]{0,80}\bstatus\b|\bstatus\s+(?:fields?|filters?|selection|tracking)\b/i), evidenced: includes(/\b(?:status|state|progress)\b/i) },
  { id: "overdue", label: "overdue summary", requested: includes(/\boverdue\b/i), evidenced: includes(/\boverdue\b/i) },
  { id: "upcoming", label: "upcoming summary", requested: includes(/\bupcoming\b/i), evidenced: includes(/\bupcoming\b/i) },
  { id: "browser_storage", label: "browser storage persistence", requested: includes(/\b(?:browser|local)\s+storage\b|\bpersist\w*\b[^.]{0,80}\b(?:browser|local)\b/i), evidenced: includes(/\b(?:localStorage|indexedDB)\b/) },
  { id: "json_import", label: "JSON import", requested: jsonOperation("import", "export"), evidenced: all(/\b(?:import|load|restore)\b/i, /\bJSON\s*(?:\.\s*parse|\[\s*["']parse["']\s*\])\s*\(/) },
  { id: "json_export", label: "JSON export", requested: jsonOperation("export", "import"), evidenced: all(/\b(?:export|download|save|backup)\b/i, /\bJSON\s*(?:\.\s*stringify|\[\s*["']stringify["']\s*\])\s*\(/) },
  { id: "sample_data", label: "realistic sample data", requested: includes(/\b(?:sample|demo|seed)\s+data\b/i), evidenced: includes(/\b(?:sample|demo|seed)[\s_-]*data\b|\[\s*\{\s*["'a-zA-Z_$][^\n]{0,120}\s*:/i) },
  { id: "empty_state", label: "clear empty states", requested: includes(/\bempty\s+states?\b/i), evidenced: includes(/\bempty\b|\bno\s+(?:tasks?|items?|results?|records?)\b/i) },
  { id: "responsive", label: "phone and desktop layout", requested: all(/\bphone\b/i, /\bdesktop\b/i), evidenced: all(/<meta\b[^>]*name\s*=\s*(?:["']viewport["']|viewport(?=\s|\/?>))/i, /@media\b|display\s*:\s*(?:grid|flex)\b|\bmax-width\s*:|\b(?:min|clamp)\s*\(/i) }
]);

// Exclude obvious inert marker stuffing without executing generated code. An
// executable script may generate its UI, so its strings remain lexical evidence.
// This is not an HTML/JavaScript parser or a semantic/behavioral validator.
function objectiveEvidence(html) {
  return String(typeof html === "string" ? html : "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/<(template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (script, attributes) => {
      const type = attributes.match(/\btype\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
      return type && !/^(?:\s*|module|(?:text|application)\/(?:java|ecma)script)\s*$/i.test(type[1] ?? type[2]) ? " " : script;
    });
}

export function requestedWebAppRequirements(request) {
  const clauses = positiveClauses(request);
  return REQUIREMENTS.filter((item) => clauses.some(item.requested)).map(({ id, label }) => ({ id, label }));
}

// A passed marker is never a passing interaction or completed objective.
export function validateWebAppObjective({ request, html }) {
  const required = requestedWebAppRequirements(request);
  const evidence = objectiveEvidence(html);
  const missing = required.filter(({ id }) => !REQUIREMENTS.find((item) => item.id === id).evidenced(evidence));
  if (missing.length) {
    throw Object.assign(new Error("The app omitted explicitly requested features."), {
      code: "web_app_requirements_missing", status: 422, missing_requirements: missing.map((item) => item.label)
    });
  }
  return { version: 1, method: "bounded_lexical_evidence", checked: required.map((item) => item.id), passed: required.map((item) => item.id) };
}
