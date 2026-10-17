export class S3ObjectStorage {
  constructor(config) {
    this.kind = "s3";
    this.config = config;
    this.client = null;
    this.modules = null;
  }

  async ready() {
    const clientModule = await import("@aws-sdk/client-s3");
    const presignerModule = await import("@aws-sdk/s3-request-presigner");
    this.modules = { ...clientModule, ...presignerModule };
    this.client = new clientModule.S3Client({
      endpoint: this.config.endpoint || undefined,
      region: this.config.region,
      forcePathStyle: Boolean(this.config.endpoint),
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey
      }
    });
    await this.client.send(new clientModule.HeadBucketCommand({
      Bucket: this.config.bucket
    }));
  }

  async health() {
    await this.client.send(new this.modules.HeadBucketCommand({
      Bucket: this.config.bucket
    }));
    return { ok: true, adapter: "s3" };
  }

  async put({ ownerId, objectId, bytes, contentType }) {
    const key = ownerId + "/" + objectId;
    await this.client.send(new this.modules.PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ServerSideEncryption: "AES256"
    }));
    return { storage_provider: this.kind, storage_key: key };
  }

  async read(key, { maxBytes = 128 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("A positive read limit is required");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let body;
    try {
      const result = await this.client.send(new this.modules.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key
      }), { abortSignal: controller.signal });
      body = result.Body;
      const tooLarge = () => Object.assign(new Error("Source exceeds the read limit"), { status: 413, code: "source_too_large" });
      if (Number(result.ContentLength) > maxBytes) throw tooLarge();
      if (!body?.[Symbol.asyncIterator]) throw new Error("Object storage returned no readable body");
      const chunks = [];
      let length = 0;
      for await (const chunk of body) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > maxBytes) throw tooLarge();
        chunks.push(bytes);
      }
      return Buffer.concat(chunks, length);
    } finally {
      clearTimeout(timer);
      body?.destroy?.();
      controller.abort();
    }
  }

  async createReadUrl(record, { expiresInSeconds = 300 } = {}) {
    return this.modules.getSignedUrl(
      this.client,
      new this.modules.GetObjectCommand({
        Bucket: this.config.bucket,
        Key: record.storage_key,
        ResponseContentType: record.content_type,
        ResponseContentDisposition:
          "attachment; filename*=UTF-8''" + encodeURIComponent(record.original_name)
      }),
      { expiresIn: Math.max(30, Math.min(900, expiresInSeconds)) }
    );
  }
}
