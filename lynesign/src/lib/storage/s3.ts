import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { StorageProvider, UploadTarget } from "./index";

const UPLOAD_URL_TTL_SECONDS = 300;
const DELETE_BATCH = 1000;

/**
 * S3-compatible storage provider. Works against AWS S3 in production and against
 * a local MinIO endpoint in dev and tests (STORAGE_ENDPOINT set).
 */
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const endpoint = process.env.STORAGE_ENDPOINT || undefined;
    const region = process.env.STORAGE_REGION || "us-east-1";
    const bucket = process.env.STORAGE_BUCKET;
    const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      const missing = [
        !bucket && "STORAGE_BUCKET",
        !accessKeyId && "STORAGE_ACCESS_KEY_ID",
        !secretAccessKey && "STORAGE_SECRET_ACCESS_KEY",
      ].filter(Boolean);
      throw new Error(`STORAGE_* env is not configured (missing ${missing.join(", ")})`);
    }

    this.bucket = bucket;
    this.client = new S3Client({
      endpoint,
      region,
      // Path-style addressing (bucket in the path, not the host) is required for
      // MinIO and any other non-AWS endpoint. Only AWS S3 gets virtual-host style.
      forcePathStyle: Boolean(endpoint),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async createUploadUrl(
    key: string,
    contentType: string,
    exactBytes: number,
  ): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        // Signed into the URL: the presigned PUT accepts a body of exactly
        // `exactBytes` and nothing else. The browser sets Content-Length from
        // the File it sends and cannot override it (it is a forbidden header),
        // so the declared size cannot be forged; any other length fails the
        // SigV4 signature check at the storage boundary.
        ContentLength: exactBytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return {
      url,
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
    };
  }

  async createDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  async putObject(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObjectStream(key: string): Promise<NodeJS.ReadableStream> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Object has no body: ${key}`);
    return res.Body as Readable;
  }

  async headObject(
    key: string,
  ): Promise<{ sizeBytes: number; contentType: string | null } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        sizeBytes: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async deletePrefix(prefix: string): Promise<void> {
    let continuationToken: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objects = (listed.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));

      for (let i = 0; i < objects.length; i += DELETE_BATCH) {
        const batch = objects.slice(i, i + DELETE_BATCH);
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
}
