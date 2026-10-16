// A display name only: never alter the exported body or infer completion.
export function documentTitleFromText(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim());
  return firstLine?.replace(/^\s{0,3}#{1,6}\s+/, "").trim().slice(0, 90) || "JERICHO Document";
}
