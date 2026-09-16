import { describe, it, expect } from "vitest";

import { storage, assetStorageKey } from "@/lib/storage";

// Guard: this suite needs a live S3 endpoint (local MinIO via `npm run
// storage:up`, or a CI service container). When nothing answers on the health
// endpoint, skip the whole suite with a warning instead of failing the run.
const HEALTH = `${process.env.STORAGE_ENDPOINT ?? "http://localhost:9000"}/minio/health/live`;
const minioLive = await fetch(HEALTH)
  .then((r) => r.ok)
  .catch(() => false);

if (!minioLive) {
  console.warn("MinIO not running; run npm run storage:up. Skipping storage suite.");
}

const suite = minioLive ? describe : describe.skip;

const KEY = assetStorageKey("test-org", "test-asset-" + Date.now(), ".txt");

suite("S3StorageProvider against local MinIO", () => {
  it("round-trips put / head / get / delete", async () => {
    await storage.putObject(KEY, Buffer.from("hello lynesign"), "text/plain");
    const head = await storage.headObject(KEY);
    expect(head?.sizeBytes).toBe(14);
    const stream = await storage.getObjectStream(KEY);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe("hello lynesign");
    await storage.deleteObject(KEY);
    expect(await storage.headObject(KEY)).toBeNull();
  });

  it("presigned PUT accepts a body of exactly the signed size and a GET returns it", async () => {
    const k = assetStorageKey("test-org", "presign-" + Date.now(), ".txt");
    const body = "signed body";
    const target = await storage.createUploadUrl(k, "text/plain", Buffer.byteLength(body));
    const put = await fetch(target.url, {
      method: "PUT",
      headers: target.headers,
      body,
    });
    expect(put.ok).toBe(true);
    const getUrl = await storage.createDownloadUrl(k, 60);
    const got = await fetch(getUrl);
    expect(await got.text()).toBe(body);
    await storage.deletePrefix("org/test-org/");
  });

  it("presigned PUT rejects a body whose size differs from the signed content-length", async () => {
    const k = assetStorageKey("test-org", "presign-bad-" + Date.now(), ".txt");
    const target = await storage.createUploadUrl(k, "text/plain", 1024);
    const put = await fetch(target.url, {
      method: "PUT",
      headers: target.headers,
      body: "eleven byte",
    });
    expect(put.ok).toBe(false);
    expect(await storage.headObject(k)).toBeNull();
    await storage.deletePrefix("org/test-org/");
  });

  it("deletePrefix removes everything under it", async () => {
    await storage.putObject("org/pfx/a/original.txt", Buffer.from("a"), "text/plain");
    await storage.putObject("org/pfx/b/original.txt", Buffer.from("b"), "text/plain");
    await storage.deletePrefix("org/pfx/");
    expect(await storage.headObject("org/pfx/a/original.txt")).toBeNull();
  });
});
