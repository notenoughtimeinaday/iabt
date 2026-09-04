import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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

  async read(key) {
    return readFile(this.resolveKey(key));
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