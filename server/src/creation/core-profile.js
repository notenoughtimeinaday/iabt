// The public product is deliberately smaller than the adapter inventory.
// Existing jobs keep their frozen route; this gate only controls new plans.
const EXTENDED_INTENTS = new Set(["audio", "video", "image", "automation", "gcode_simulation"]);
export const coreStarter = (request) => {
  const text = String(request || "");
  if (/\b(piano|keyboard instrument|musical keyboard)\b/i.test(text)) return "piano";
  if (/\b(?:storefront|merchandise|shopping cart|store|shop)\b.{0,40}\b(?:starter|demo)\b|\b(?:starter|demo)\b.{0,40}\b(?:storefront|store|shop)\b/i.test(text)) return "storefront";
  if (/\b(task[- ]list|to-?do(?: list)?|checklist app|task tracker)\b/i.test(text)) return "task_list";
  return null;
};
export const CORE_STARTER_MESSAGE = "Custom app creation is not available right now. You can create a piano, storefront demo, or task-list starter. Nothing was charged.";
export function assertCreationProfile({ config, user, intent }) {
  if (EXTENDED_INTENTS.has(intent) && !(config.creation?.profile === "advanced" && user?.role === "admin")) {
    throw Object.assign(new Error("Jericho currently focuses on apps, websites and documents. This feature is paused; your saved work is still available. Nothing was charged."), { status: 422, code: "creation_feature_paused" });
  }
}
