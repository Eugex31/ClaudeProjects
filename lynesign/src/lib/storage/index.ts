import { S3StorageProvider } from "./s3";

export type UploadTarget = {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
};

export interface StorageProvider {
  createUploadUrl(key: string, contentType: string, exactBytes: number): Promise<UploadTarget>;
  createDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  getObjectStream(key: string): Promise<NodeJS.ReadableStream>;
  headObject(
    key: string,
  ): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

// Memoised on globalThis in dev so Next.js hot-reloads and the vitest worker do
// not spin up a fresh S3 client (and its connection pool) on every module
// reload. Mirrors src/lib/db/root.ts.
const g = globalThis as unknown as { storage?: StorageProvider };
export const storage: StorageProvider = g.storage ?? new S3StorageProvider();
if (process.env.NODE_ENV !== "production") g.storage = storage;

/**
 * Object-key prefix for everything belonging to one asset (original + thumb).
 * The single source of truth for that layout; `deletePrefix` callers pass this.
 */
export function assetPrefix(orgId: string, assetId: string): string {
  return `org/${orgId}/${assetId}/`;
}

/**
 * Storage key for an asset's original upload. Always derived server-side from
 * the org and asset ids and the file extension; never built from caller input.
 */
export function assetStorageKey(orgId: string, assetId: string, ext: string): string {
  const dotExt = ext.startsWith(".") ? ext : `.${ext}`;
  return `${assetPrefix(orgId, assetId)}original${dotExt}`;
}

/** Storage key for an asset's generated thumbnail. Always a webp. */
export function assetThumbKey(orgId: string, assetId: string): string {
  return `${assetPrefix(orgId, assetId)}thumb.webp`;
}
