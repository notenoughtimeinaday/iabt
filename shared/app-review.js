// These are instructions for a person, never recorded as completed tests.
const targetedSteps = Object.freeze({
  add: "Add a new item with realistic values and confirm it appears once.",
  edit: "Edit an existing item and confirm the change updates that item without creating a duplicate.",
  complete: "Mark an item complete, undo it if supported, and check the displayed status and totals.",
  delete: "Delete an item and confirm the intended item is removed and totals update.",
  search: "Search for an existing and a missing item; clear the search and confirm all items return.",
  hour_totals: "Add and complete entries with different hours, edit and delete them, and verify planned and completed totals after each action.",
  filter: "Try each filter, combine filters where supported, and confirm resetting them restores all results.",
  overdue: "Create a past-due item and confirm the overdue summary updates correctly.",
  upcoming: "Create an upcoming item and confirm the upcoming summary uses the intended date window.",
  browser_storage: "In the downloaded HTML, save data and reload. Also check that blocked or corrupt browser storage produces a readable message without breaking the app.",
  json_import: "Import a valid JSON file, then an invalid one. Invalid input must leave existing data unchanged and explain the problem.",
  json_export: "Export your data and inspect the JSON. If import is supported, re-import it and compare the records.",
  sample_data: "Check that sample records are realistic, clearly identified, and do not silently replace your saved data.",
  empty_state: "Clear the data or use a filter with no matches; confirm the app explains what to do next."
});
const commonSteps = Object.freeze([
  { id: "requested_workflow", text: "Compare the app with your full request and supplied files. Try every requested workflow, not just the visible buttons." },
  { id: "input_safety", text: "Try blank, invalid and long input, plus text containing < and >. The app should explain errors and display your text safely." },
  { id: "responsive_accessibility", text: "Try phone and desktop widths, keyboard-only navigation, readable contrast and visible focus. Check that important controls and results remain usable." }
]);

export function appReviewSteps(requirementIds = []) {
  const ids = Array.isArray(requirementIds) ? [...new Set(requirementIds.filter((id) => typeof id === "string"))] : [];
  return [
    ...commonSteps.map((item) => ({ ...item })),
    ...ids.filter((id) => Object.hasOwn(targetedSteps, id)).map((id) => ({ id, text: targetedSteps[id] }))
  ];
}
