// Transport-agnostic object storage port. Adapters live in `r2.server.ts`
// (production) and `local.server.ts` (dev/test); `port.ts` turns one into the port and
// `index.server.ts` selects which.

import type { KeySetPrefix, KeySetScope, ObjectKey } from "./keys";

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

/**
 * One key a listing reported, with the moment the store last wrote it.
 *
 * The age is what makes a sweep safe to run unattended. An object's owner is written last — a cover
 * row names a segment only after that segment's objects exist, an export is spooled after the content
 * it fingerprints was read — so a rule that reads "the owner no longer names this" as "this is
 * abandoned" can delete a set that is being written right now. A store always knows when it wrote an
 * object, so a set whose objects are all older than a grace period cannot be one of those.
 *
 * The key is a plain string, for the reason `listSet` gives: a bucket holds whatever was written to
 * it, including shapes from an older layout, and a caller that acts on one reads it back with
 * `parseObjectKey`.
 */
export interface StorageObjectEntry {
  key: string;
  lastModified: Date;
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

/**
 * What an adapter implements: objects by key, and sets by a scope the port already resolved.
 *
 * No method reads a caller's prefix. A backend takes a `KeySetScope` and chooses the field
 * its own transport needs — a filesystem names the directory `name`, a store that matches
 * raw string prefixes lists or deletes `boundary` — so a third adapter cannot interpret a
 * prefix differently from the other two, because it is never handed one. The trailing
 * separator that R2 needs and the filesystem does not is derived once, in `keys.ts`.
 *
 * Keys and prefixes are branded here too, as they are on the port: an adapter is keyed the same way
 * its callers are, so the rule binds at the adapter's own boundary rather than only where the port
 * wraps it, and reaching one with a string built by hand takes a cast that says so. What an adapter
 * keeps of its own is the safety of the *path* it builds from a key — the filesystem still refuses a
 * key that would climb out of its root — which is a different question from whether the vocabulary
 * derives the key at all.
 */
export interface ObjectStorageBackend {
  /** Writes or replaces one object. Rejects when the store refuses the write. */
  put(key: ObjectKey, bytes: Uint8Array, options: StoragePutOptions): Promise<void>;
  /** Reads one object, or null when it does not exist. */
  get(key: ObjectKey): Promise<StorageObject | null>;
  /** Metadata-only read used to verify an upload without downloading it. */
  head(key: ObjectKey): Promise<StorageHead | null>;
  delete(key: ObjectKey): Promise<void>;
  /** Removes every object in one resolved set; a missing set is a no-op. */
  removeSet(scope: KeySetScope): Promise<void>;
  /**
   * Every key in one resolved set, as the plain strings a listing reports. Null means the bucket as
   * a whole could not be listed, which is deliberately distinct from an empty list.
   *
   * Not `ObjectKey[]`: a bucket holds whatever was written to it, including shapes from an older
   * layout, and a listing that hid them would make the audit's report of what nothing owns
   * impossible. A caller that acts on one reads it back with `parseObjectKey`.
   */
  listSet(scope: KeySetScope): Promise<string[] | null>;
  /**
   * The same set, with the moment each object was written. Null is `listSet`'s null: the bucket
   * could not be listed at all, which is never an empty listing.
   */
  listObjects(scope: KeySetScope): Promise<StorageObjectEntry[] | null>;
  /**
   * Capability URL that lets the caller write exactly one key for a bounded time. The
   * signature covers the host and expiry, so the URL cannot be replayed against another
   * key; the media type is advisory and travels unsigned.
   */
  presignPut(key: ObjectKey, options: PresignPutOptions): Promise<string>;
  /**
   * Public CDN URL for a key, or null when this bucket is not publicly readable.
   * Null is the signal to serve through the application's proxy route instead.
   */
  publicUrl(key: ObjectKey): string | null;
}

/**
 * A bucket, addressed only by keys and sets the vocabulary derives.
 *
 * Every parameter is a branded `ObjectKey` or `KeySetPrefix`, so a plain string is refused at
 * compile time: a value reaches these methods because `keys.ts` built it or read it back. The same
 * rule is asked again at runtime in `port.ts`, which wraps the selected adapter, so a value that
 * arrived as data or through a cast cannot reach a bucket either, and a stray object is something
 * the audit reports rather than something this port creates.
 */
export interface ObjectStorage {
  /** Writes or replaces one object. Rejects when the store refuses the write. */
  put(key: ObjectKey, bytes: Uint8Array, options: StoragePutOptions): Promise<void>;
  /** Reads one object, or null when it does not exist. */
  get(key: ObjectKey): Promise<StorageObject | null>;
  /** Metadata-only read used to verify an upload without downloading it. */
  head(key: ObjectKey): Promise<StorageHead | null>;
  delete(key: ObjectKey): Promise<void>;
  /**
   * Removes every object in one key set; a missing set is a no-op. The argument names
   * the set (`covers/<novelId>/<segment>`), resolved here to that set's own keys, so it
   * can never reach a key that merely starts with the same characters.
   */
  deletePrefix(prefix: KeySetPrefix): Promise<void>;
  /** Every key in one key set, scoped exactly as `deletePrefix` scopes it. */
  listKeys(prefix: KeySetPrefix): Promise<string[] | null>;
  /**
   * The same key set with the moment each object was written, for a sweep that must not act on an
   * object younger than its grace period. Scoped exactly as `listKeys` is.
   */
  listObjects(prefix: KeySetPrefix): Promise<StorageObjectEntry[] | null>;
  presignPut(key: ObjectKey, options: PresignPutOptions): Promise<string>;
  publicUrl(key: ObjectKey): string | null;
}
