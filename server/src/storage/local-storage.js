import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SignedDownloadGateway } from "./download-gateway.js";

export class LocalObjectStorage extends SignedDownloadGateway {
  constructor({ rootDirectory, apiOrigin, signingSecret }) {
    super({ apiOrigin, signingSecret });
    this.kind = "local";
    this.rootDirectory = path.resolve(rootDirectory);
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

  async openReadStream(key, { signal } = {}) {
    const handle = await open(this.resolveKey(key), "r");
    try {
      const stat = await handle.stat();
      return { stream: handle.createReadStream({ signal }), sizeBytes: stat.size };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}
