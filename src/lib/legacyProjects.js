import { normalizeAppDefinition } from "@/lib/appDefinition";

const LEGACY_INDEX_KEY = "iabt.projectsIndex";

function parse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readLegacyProjects() {
  if (typeof window === "undefined") return [];
  const index = parse(localStorage.getItem(LEGACY_INDEX_KEY));
  if (!Array.isArray(index)) return [];

  const recovered = [];
  for (const entry of index.slice(0, 100)) {
    if (!entry || typeof entry !== "object") continue;
    let source = entry;
    if (!Array.isArray(entry.pages) && entry.id) {
      const record = parse(localStorage.getItem("iabt.project." + entry.id));
      if (record) source = record;
    }
    const rawDefinition = source.appDefinition || source.app_definition || source;
    if (!rawDefinition || !Array.isArray(rawDefinition.pages)) continue;
    const legacyId = String(source.id || entry.id || ("legacy-" + recovered.length));
    const name = String(source.name || entry.name || rawDefinition.name || rawDefinition.appName || "Recovered IABT project");
    recovered.push({
      legacyId,
      name,
      definition: normalizeAppDefinition(rawDefinition, name),
    });
  }

  const seen = new Set();
  return recovered.filter((item) => {
    if (seen.has(item.legacyId)) return false;
    seen.add(item.legacyId);
    return true;
  });
}

export function legacyTag(legacyId) {
  return "legacy:" + String(legacyId).slice(0, 80);
}
