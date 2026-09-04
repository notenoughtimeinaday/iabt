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