import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
};

export class LocalObjectStorage {
  constructor({ rootDirectory, apiOrigin, signingSecret }) {
    this.kind = "local";
    this.rootDirectory = path.resolve(rootDirectory);
    this.apiOrigin = String(apiOrigin || "").replace(/\/+$/, "");
    this.signingSecret = signingSecret;
  }

  async ready() {
    await mkdir(this.rootDirectory, { recursive: true });
  }

  async health() {
    await mkdir(this.rootDirectory, { recursive: true });
    return { ok: true, adapter: "local" };
  }

  resolveKey(key) {
    const target = path.resolve(this.rootDirectory, String(key || ""));
    if (!target.startsWith(this.rootDirectory + path.sep)) {
      throw new Error("Unsafe storage key");
    }
    return target;
  }

  async put({ ownerId, objectId, bytes }) {
    const key = ownerId + "/" + objectId;
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    return { storage_provider: this.kind, storage_key: key };
  }

  async read(key, { maxBytes } = {}) {
    const target = this.resolveKey(key);
    if (maxBytes === undefined) return readFile(target);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("A positive read limit is required");
    const handle = await open(target, "r");
    try {
      const stat = await handle.stat();
      const tooLarge = () => Object.assign(new Error("Source exceeds the read limit"), { status: 413, code: "source_too_large" });
      if (stat.size > maxBytes) throw tooLarge();
      // A second bound on the actual read also handles growth after stat().
      const buffer = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > maxBytes) throw tooLarge();
      }
      return buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
  }

  signature(objectId, expiresAt) {
    return createHmac("sha256", this.signingSecret)
      .update(String(objectId) + ":" + String(expiresAt))
      .digest("base64url");
  }

  verifyDownload(objectId, expiresAt, signature) {
    const expires = Number(expiresAt);
    if (!Number.isFinite(expires) || expires <= Date.now()) return false;
    return safeEqual(signature, this.signature(objectId, expires));
  }

  async createReadUrl(record, { expiresInSeconds = 300 } = {}) {
    const expires = Date.now() + Math.max(30, Math.min(900, expiresInSeconds)) * 1000;
    const signature = this.signature(record.id, expires);
    return (
      this.apiOrigin +
      "/v1/files/" +
      encodeURIComponent(record.id) +
      "/content?expires=" +
      expires +
      "&signature=" +
      encodeURIComponent(signature)
    );
  }
}
