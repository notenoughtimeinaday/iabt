import { createHash } from "node:crypto";
import { extname } from "node:path";
import { classifyFailure } from "../autonomy/recovery.js";
import { normalizeFileIds, referenceBinding, sourceReferences } from "./text-sources.js";

// Application limits, deliberately below the provider's request ceiling. Only
// one still image is supported; files are never exposed through a public URL.
export const IMAGE_SOURCE_LIMITS = Object.freeze({ files: 1, fileBytes: 5 * 1024 * 1024, dimension: 8192, pixels: 16 * 1024 * 1024 });
const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const invalid = () => fail(415, "image_source_invalid", "The attached image is not a supported, complete JPEG or PNG. Export the original photo as JPEG or PNG and attach it again.");

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// Validate the container, dimensions and declared media type. This is not a
// pixel decoder or moderation decision; the renderer still validates/moderates
// the actual image. No image library executes embedded metadata or active data.
export const inspectImageSource = (bytes, contentType) => {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > IMAGE_SOURCE_LIMITS.fileBytes) invalid();
  let width = 0;
  let height = 0;
  if (contentType === "image/png") {
    if (bytes.length < 45 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") invalid();
    let offset = 8;
    let dataSeen = false;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) invalid();
      const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) invalid();
      if (offset === 8) {
        if (type !== "IHDR" || length !== 13) invalid();
        width = bytes.readUInt32BE(offset + 8);
        height = bytes.readUInt32BE(offset + 12);
        const depth = bytes[offset + 16];
        const colorType = bytes[offset + 17];
        const legalDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!legalDepths[colorType]?.includes(depth)) invalid();
        if (bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) invalid();
      } else if (type === "IHDR" || type === "acTL") invalid();
      if (type === "IDAT" && length) dataSeen = true;
      offset += length + 12;
      if (type === "IEND") {
        if (length || !dataSeen || offset !== bytes.length) invalid();
        ended = true;
        break;
      }
    }
    if (!ended) invalid();
  } else if (contentType === "image/jpeg") {
    if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8) invalid();
    let offset = 2;
    let scanned = false;
    let ended = false;
    const componentIds = new Set();
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        if (!scanned || offset !== bytes.length) invalid();
        ended = true;
        break;
      }
      if (marker === undefined || marker === 0 || marker === 0xd8 || offset + 2 > bytes.length) invalid();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) invalid();
      // Baseline, extended sequential and progressive DCT still photos only.
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || width || bytes[offset + 2] !== 8) invalid();
        const components = bytes[offset + 7];
        if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) invalid();
        for (let index = 0; index < components; index += 1) {
          const id = bytes[offset + 8 + index * 3];
          const sampling = bytes[offset + 9 + index * 3];
          if (componentIds.has(id) || !(sampling >> 4) || (sampling >> 4) > 4 || !(sampling & 15) || (sampling & 15) > 4 || bytes[offset + 10 + index * 3] > 3) invalid();
          componentIds.add(id);
        }
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
      }
      if (marker === 0xda) {
        const components = bytes[offset + 2];
        if (!components || components > componentIds.size || length !== 6 + 2 * components) invalid();
        const selected = new Set();
        for (let index = 0; index < components; index += 1) {
          const id = bytes[offset + 3 + index * 2];
          if (!componentIds.has(id) || selected.has(id)) invalid();
          selected.add(id);
        }
      }
      offset += length;
      if (marker === 0xda) {
        if (!width || !height) invalid();
        scanned = true;
        const scanStart = offset;
        // Skip entropy-coded data, including stuffed bytes/restart markers,
        // until the next actual marker (progressive JPEG may have many scans).
        while (offset < bytes.length) {
          if (bytes[offset] !== 0xff) { offset += 1; continue; }
          const next = bytes[offset + 1];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
          break;
        }
        if (offset === scanStart) invalid();
      }
    }
    if (!ended) invalid();
  } else invalid();
  if (!width || !height || width > IMAGE_SOURCE_LIMITS.dimension || height > IMAGE_SOURCE_LIMITS.dimension || width * height > IMAGE_SOURCE_LIMITS.pixels) {
    fail(413, "image_source_dimensions", "Use a still image no larger than 8,192 pixels on either side and 16 megapixels total.");
  }
  return { width, height, contentType };
};

export const readImageSources = async ({ repository, storage, user, fileIds, expectedReferences }) => {
  const ids = normalizeFileIds(fileIds);
  if (ids.length !== IMAGE_SOURCE_LIMITS.files) fail(422, "image_source_count", "Image-to-video currently accepts one still JPEG or PNG. Attach the individual photo you want to animate.");
  if (!user?.id) fail(401, "auth_required", "Sign in to read attached images.");
  if (!storage?.read) fail(503, "source_storage_not_configured", "Private file reading is not configured.");
  const record = await repository.getStoredObject(ids[0], { ...user, role: "user" });
  if (!record || record.owner_id !== user.id) fail(404, "source_not_found", "An attached file was not found in your account.");
  if (record.storage_provider !== storage.kind) fail(409, "source_storage_mismatch", "An attached file requires its original storage adapter.");
  const contentType = String(record.content_type || "").toLowerCase();
  const extension = extname(record.original_name || "").toLowerCase();
  if (!(contentType === "image/jpeg" && [".jpg", ".jpeg"].includes(extension)) && !(contentType === "image/png" && extension === ".png")) {
    fail(415, "image_source_type_unsupported", "Image-to-video accepts one JPEG or PNG photo; PDF, text, animated images and other formats are not supported.");
  }
  const size = Number(record.size_bytes);
  if (!Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{64}$/.test(record.sha256 || "")) fail(409, "source_integrity_failed", "An attached image has invalid integrity metadata. Upload it again.");
  if (size > IMAGE_SOURCE_LIMITS.fileBytes) fail(413, "image_source_too_large", "Image-to-video accepts a photo of at most 5 MiB.");
  let bytes;
  try { bytes = await storage.read(record.storage_key, { maxBytes: IMAGE_SOURCE_LIMITS.fileBytes }); }
  catch (error) {
    if (error.code === "source_too_large") fail(413, "image_source_too_large", "Image-to-video accepts a photo of at most 5 MiB.");
    const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || error?.status);
    const permanent = [401, 403, 404].includes(status) || ["ENOENT", "EACCES", "EPERM", "NoSuchKey", "NoSuchBucket", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"].includes(error?.code || error?.name);
    const retryable = !permanent && (classifyFailure(error).retryable || error?.$retryable?.throttling === true || status === 429 || (status >= 500 && status <= 599));
    throw Object.assign(new Error("The attached image could not be read from private storage. Try again when storage is available."), { code: "source_unavailable", status: retryable ? 503 : 409, retryable });
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== record.sha256) fail(409, "source_integrity_failed", "The attached image no longer matches its saved size and checksum. Upload it again.");
  const dimensions = inspectImageSource(bytes, contentType);
  const sources = [{
    reference: { file_id: record.id, name: record.original_name, mime_type: record.content_type, size_bytes: size, sha256: record.sha256 },
    bytes,
    ...dimensions
  }];
  if (expectedReferences && JSON.stringify(referenceBinding(sourceReferences(sources))) !== JSON.stringify(referenceBinding(expectedReferences))) fail(409, "source_changed", "The approved image references have changed. Request a new plan.");
  return sources;
};
