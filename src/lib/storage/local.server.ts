import "@tanstack/react-start/server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/lib/env";

import type { KeySetScope, ObjectKey } from "./keys";
import type {
  ObjectStorageBackend,
  StorageHead,
  StorageObject,
  StorageObjectEntry,
  StoragePutOptions,
} from "./types";

/**
 * Filesystem adapter used when R2 is not configured (local dev, CI, unit tests).
 *
 * `publicUrl` always returns null, so every read goes through the application's
 * proxy route. Presigned PUTs point back at the app's own upload receiver, which
 * keeps the browser upload code path identical to production without a bucket.
 */
const STORAGE_ROOT = path.join(process.cwd(), ".tura", "storage");
const UPLOAD_ROUTE = "/api/storage/upload";
/** Presigned local uploads are single-use capabilities; keep the window short. */
export const LOCAL_UPLOAD_MAX_EXPIRES_SECONDS = 3600;

const SAFE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function assertSafeKey(key: string): void {
  if (
    !SAFE_KEY_RE.test(key) ||
    key.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

/** A prefix may be empty (the whole bucket) but never escapes the bucket root. */
function assertSafePrefix(prefix: string): void {
  if (prefix === "") return;
  assertSafeKey(prefix);
}

/** Suffix of the sidecar this adapter writes beside every object. */
const META_SUFFIX = ".meta.json";

/**
 * Recursively collects the objects stored under a directory. Each object is paired with
 * a `<key>.meta.json` sidecar, which is this adapter's own bookkeeping rather than a
 * key a caller stored; the sidecar is skipped only when the file it annotates is
 * present, so a key that genuinely carries that suffix still lists.
 *
 * The write time comes from the object's own file, not its sidecar: it is what the bucket
 * would report, and it is what a sweep with a grace period reads.
 */
async function listObjectsUnder(rootDir: string, prefix: string): Promise<StorageObjectEntry[]> {
  // A directory that was never written is an empty bucket. Any other failure is a
  // real one and is raised: a caller that reconciled on a swallowed error would
  // read "nothing was inspected" as "nothing is there".
  const entries = await readdir(rootDir, { withFileTypes: true }).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  });
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const objects: StorageObjectEntry[] = [];

  for (const entry of entries) {
    const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      objects.push(...(await listObjectsUnder(path.join(rootDir, entry.name), key)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(META_SUFFIX) && files.has(entry.name.slice(0, -META_SUFFIX.length))) {
      continue;
    }
    const stats = await stat(path.join(rootDir, entry.name));
    objects.push({ key, lastModified: stats.mtime });
  }

  return objects;
}

function objectPath(bucket: string, key: ObjectKey): string {
  assertSafeKey(key);
  return path.join(STORAGE_ROOT, bucket, key);
}

function metaPath(objectFilePath: string): string {
  return `${objectFilePath}.meta.json`;
}

interface LocalMeta {
  contentType: string | null;
}

async function readMeta(objectFilePath: string): Promise<LocalMeta | null> {
  try {
    const raw = await readFile(metaPath(objectFilePath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    return {
      contentType: typeof record.contentType === "string" ? record.contentType : null,
    };
  } catch {
    return null;
  }
}

export function createLocalObjectStorage(bucket: string): ObjectStorageBackend {
  // One traversal, two views: a caller that only wants keys maps them here rather than
  // walking the tree a second time.
  const listObjectsInSet = async (scope: KeySetScope): Promise<StorageObjectEntry[]> => {
    assertSafePrefix(scope.name);
    const rootDir = path.join(STORAGE_ROOT, bucket, scope.name);
    // Sorted so two adapters agree; a caller never depends on the order.
    return (await listObjectsUnder(rootDir, scope.name)).toSorted((left, right) =>
      left.key.localeCompare(right.key),
    );
  };

  return {
    async put(key: ObjectKey, bytes, options: StoragePutOptions) {
      const file = objectPath(bucket, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      const meta: LocalMeta = { contentType: options.contentType };
      await writeFile(metaPath(file), JSON.stringify(meta));
    },

    async get(key: ObjectKey): Promise<StorageObject | null> {
      const file = objectPath(bucket, key);
      try {
        const bytes = await readFile(file);
        return {
          bytes: new Uint8Array(bytes),
          contentType: (await readMeta(file))?.contentType ?? null,
        };
      } catch {
        return null;
      }
    },

    async head(key: ObjectKey): Promise<StorageHead | null> {
      const file = objectPath(bucket, key);
      try {
        return { size: (await stat(file)).size };
      } catch {
        return null;
      }
    },

    async delete(key: ObjectKey) {
      const file = objectPath(bucket, key);
      await unlink(file).catch(() => {});
      await unlink(metaPath(file)).catch(() => {});
    },

    async removeSet(scope: KeySetScope) {
      // The port resolved the set; this adapter only has to name the directory it is.
      assertSafePrefix(scope.name);
      await rm(path.join(STORAGE_ROOT, bucket, scope.name), { recursive: true, force: true });
    },

    async listSet(scope: KeySetScope) {
      return (await listObjectsInSet(scope)).map((object) => object.key);
    },

    listObjects: listObjectsInSet,

    async presignPut(key: ObjectKey, { expiresIn }) {
      assertSafeKey(key);
      const expires = Math.min(expiresIn, LOCAL_UPLOAD_MAX_EXPIRES_SECONDS);
      const expiresAt = Math.floor(Date.now() / 1000) + expires;
      const signature = localUploadSignature(key, bucket, expiresAt);
      const params = new URLSearchParams({
        bucket,
        key,
        expires: String(expiresAt),
        signature,
      });
      return `${UPLOAD_ROUTE}?${params.toString()}`;
    },

    publicUrl() {
      return null;
    },
  };
}

function localUploadSecret(): string {
  return env.APP_ENCRYPTION_KEY;
}

function localUploadSignature(key: string, bucket: string, expiresAt: number): string {
  return createHmac("sha256", localUploadSecret())
    .update(`${bucket}\n${key}\n${expiresAt}`)
    .digest("hex");
}

/** Constant-time verification used by the dev-only upload receiver route. */
export function verifyLocalUploadToken(input: {
  bucket: string;
  key: string;
  expires: number;
  signature: string;
}): boolean {
  if (!Number.isSafeInteger(input.expires) || input.expires * 1000 < Date.now()) return false;
  const expected = Buffer.from(localUploadSignature(input.key, input.bucket, input.expires), "hex");
  const provided = Buffer.from(input.signature, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
