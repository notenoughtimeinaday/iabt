import { LocalObjectStorage } from "./local-storage.js";

export const createObjectStorage = async (config) => {
  let storage;
  if (config.storage.provider === "s3") {
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