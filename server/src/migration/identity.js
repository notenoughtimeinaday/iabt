import { createHash } from "node:crypto";

// Deterministically maps a Base44 source identifier to an RFC 4122 UUID.
// The mapping is stable across reruns so relationships can be migrated in batches.
export const base44SourceIdToUuid = (sourceId) => {
  const source = String(sourceId || "").trim();
  if (!source) throw new Error("Base44 source ID is required");
  const bytes = Buffer.from(
    createHash("sha256").update(`iabt-base44:${source}`).digest().subarray(0, 16)
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
};
