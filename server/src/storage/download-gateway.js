import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// Match the existing video adapter's maximum artifact size without buffering it.
export const MAX_DOWNLOAD_BYTES = 200_000_000;
export const DOWNLOAD_TIMEOUT_MS = 120_000;
const FINAL_CHUNK_BYTES = 64 * 1024;

const downloadError = (code = "file_download_failed", status = 502) => Object.assign(
  new Error("The private file could not be downloaded. Please try again."),
  { status, code }
);

export class SignedDownloadGateway {
  constructor({ apiOrigin, signingSecret }) {
    this.apiOrigin = String(apiOrigin || "").replace(/\/+$/, "");
    this.signingSecret = signingSecret;
  }

  signature(objectId, expiresAt) {
    if (!this.signingSecret) throw downloadError("download_signing_unavailable", 503);
    // Preserve the signature format used by existing local-storage links.
    return createHmac("sha256", this.signingSecret)
      .update(String(objectId) + ":" + String(expiresAt))
      .digest("base64url");
  }

  verifyDownload(objectId, expiresAt, signature) {
    const expires = Number(expiresAt);
    if (!Number.isSafeInteger(expires) || expires <= Date.now()) return false;
    const supplied = Buffer.from(String(signature || ""));
    const expected = Buffer.from(this.signature(objectId, expires));
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  async createDownloadUrl(record, { expiresInSeconds = 300 } = {}) {
    const seconds = Number.isFinite(expiresInSeconds) ? expiresInSeconds : 300;
    const expires = Date.now() + Math.round(Math.max(30, Math.min(900, seconds)) * 1000);
    const signature = this.signature(record.id, expires);
    return this.apiOrigin + "/v1/files/" + encodeURIComponent(record.id)
      + "/content?expires=" + expires + "&signature=" + encodeURIComponent(signature);
  }

  async createReadUrl(record, options) {
    return this.createDownloadUrl(record, options);
  }
}

export const streamPrivateDownload = async ({
  req, res, storage, record, headers = {}, timeoutMs = DOWNLOAD_TIMEOUT_MS
}) => {
  const size = record.size_bytes;
  if (record.storage_provider !== storage.kind || typeof record.storage_key !== "string" || !record.storage_key
      || !Number.isSafeInteger(size) || size < 0 || size > MAX_DOWNLOAD_BYTES
      || !/^[a-f0-9]{64}$/i.test(record.sha256 || "") || !storage.openReadStream) {
    throw downloadError("file_download_unavailable", 409);
  }

  const controller = new AbortController();
  let source;
  const abort = () => { controller.abort(); source?.destroy?.(); };
  const closed = () => { if (!res.writableFinished) abort(); };
  req.once("aborted", abort);
  res.once("close", closed);
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (req.aborted || res.destroyed) {
      abort();
      return;
    }
    const opened = await storage.openReadStream(record.storage_key, { signal: controller.signal });
    source = opened.stream;
    if (controller.signal.aborted) throw downloadError();
    if (!source?.pipe || (opened.sizeBytes !== undefined && opened.sizeBytes !== size)) {
      throw downloadError("file_integrity_mismatch");
    }

    let length = 0;
    let tail = Buffer.alloc(0);
    const digest = createHash("sha256");
    const verify = new Transform({
      transform(chunk, _encoding, done) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += bytes.length;
        if (length > size) return done(downloadError("file_integrity_mismatch"));
        digest.update(bytes);
        // Hold only the last bounded chunk: a checksum/length failure must not
        // deliver Content-Length bytes and appear to be a completed download.
        if (bytes.length >= FINAL_CHUNK_BYTES) {
          if (tail.length) this.push(tail);
          if (bytes.length > FINAL_CHUNK_BYTES) this.push(bytes.subarray(0, -FINAL_CHUNK_BYTES));
          tail = Buffer.from(bytes.subarray(-FINAL_CHUNK_BYTES));
        } else {
          const combined = Buffer.concat([tail, bytes]);
          const prefix = Math.max(0, combined.length - FINAL_CHUNK_BYTES);
          if (prefix) this.push(combined.subarray(0, prefix));
          tail = Buffer.from(combined.subarray(prefix));
        }
        done();
      },
      flush(done) {
        if (length !== size || digest.digest("hex") !== record.sha256.toLowerCase()) {
          return done(downloadError("file_integrity_mismatch"));
        }
        if (tail.length) this.push(tail);
        done();
      }
    });
    const filename = String(record.original_name || "download")
      .replace(/[\\/\u0000-\u001f\u007f]+/g, "-").trim().slice(0, 160) || "download";
    const encodedFilename = encodeURIComponent(Buffer.from(filename, "utf8").toString("utf8"))
      .replace(/['()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());
    // Never render untrusted file bytes on the API origin. The app controls
    // these headers; S3 response-header override support is not required.
    res.writeHead(200, {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodedFilename,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Referrer-Policy": "no-referrer"
    });
    await pipeline(source, verify, res, { signal: controller.signal });
  } catch {
    // The stream may already have sent bytes. Terminate it rather than append
    // JSON or accidentally report a corrupt/truncated attachment as successful.
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    throw downloadError();
  } finally {
    clearTimeout(timer);
    req.off("aborted", abort);
    res.off("close", closed);
    source?.destroy?.();
    controller.abort();
  }
};
