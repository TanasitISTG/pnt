// Transport-agnostic object storage port. Adapters live in `r2.server.ts`
// (production) and `local.server.ts` (dev/test); `index.server.ts` selects one.

export type StorageBucket = "public" | "private";

export interface StorageObject {
  bytes: Uint8Array;
  contentType: string | null;
}

// Verifying an upload needs its size and nothing else. No adapter can report a media
// type from a metadata-only read, so the contract does not pretend to.
export interface StorageHead {
  size: number;
}

// Caching is a bucket/domain rule, not a per-object header: cover keys are immutable and
// the public CDN origin carries a long-lived cache rule. See architect.md.
export interface StoragePutOptions {
  contentType: string;
}

export interface PresignPutOptions {
  contentType: string;
  expiresIn: number;
}

export interface ObjectStorage {
  /** Writes or replaces one object. Rejects when the store refuses the write. */
  put(key: string, bytes: Uint8Array, options: StoragePutOptions): Promise<void>;
  /** Reads one object, or null when it does not exist. */
  get(key: string): Promise<StorageObject | null>;
  /** Metadata-only read used to verify an upload without downloading it. */
  head(key: string): Promise<StorageHead | null>;
  delete(key: string): Promise<void>;
  /** Removes every object under a prefix; a missing prefix is a no-op. */
  deletePrefix(prefix: string): Promise<void>;
  /**
   * Every key under a prefix, for callers that reconcile the bucket against the
   * database. Null means the bucket as a whole could not be listed, which is
   * deliberately distinct from an empty list: a sweep that read "no keys" from an
   * unreachable bucket would report a clean pass having inspected nothing.
   */
  listKeys(prefix: string): Promise<string[] | null>;
  /**
   * Capability URL that lets the caller write exactly one key for a bounded time. The
   * signature covers the host and expiry, so the URL cannot be replayed against another
   * key; the media type is advisory and travels unsigned.
   */
  presignPut(key: string, options: PresignPutOptions): Promise<string>;
  /**
   * Public CDN URL for a key, or null when this bucket is not publicly readable.
   * Null is the signal to serve through the application's proxy route instead.
   */
  publicUrl(key: string): string | null;
}
