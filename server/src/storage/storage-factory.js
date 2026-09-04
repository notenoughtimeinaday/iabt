import { LocalObjectStorage } from "./local-storage.js";

export const createObjectStorage = async (config) => {
  let storage;
  if (config.storage.provider === "s3") {
    const missing = [
      ...(!config.storage.bucket ? ["IABT_STORAGE_BUCKET"] : []),
      ...(!config.storage.accessKeyId ? ["IABT_STORAGE_ACCESS_KEY_ID"] : []),
      ...(!config.storage.secretAccessKey ? ["IABT_STORAGE_SECRET_ACCESS_KEY"] : [])
    ];
    if (missing.length) {
      throw new Error("Private object storage is missing: " + missing.join(", "));
    }
    const { S3ObjectStorage } = await import("./s3-storage.js");
    storage = new S3ObjectStorage(config.storage);
  } else {
    if (config.environment === "production") {
      throw new Error("S3-compatible private object storage is required in production");
    }
    storage = new LocalObjectStorage({
      rootDirectory: config.storage.localDirectory,
      apiOrigin: config.apiOrigin,
      signingSecret: config.authSecret
    });
  }
  await storage.ready();
  return storage;
};