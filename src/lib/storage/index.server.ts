import "@tanstack/react-start/server-only";

import { env } from "@/lib/env";

import { createLocalObjectStorage } from "./local.server";
import { createObjectStorage } from "./port";
import { createR2ObjectStorage } from "./r2.server";
import type { ObjectStorage, ObjectStorageBackend } from "./types";

/**
 * Two buckets: `public` is served from the CDN origin and holds only published
 * cover variants; `private` holds staged EPUB archives and cached exports and is
 * never readable without a signed URL or the application's own credentials.
 */
export interface StorageBuckets {
  public: ObjectStorage;
  private: ObjectStorage;
}

let cached: StorageBuckets | null = null;

/** The configured backends, before the port is built on them. */
type StorageBackends = Record<keyof StorageBuckets, ObjectStorageBackend>;

function createStorage(): StorageBackends {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_PUBLIC_BUCKET,
    R2_PRIVATE_BUCKET,
    R2_PUBLIC_BASE_URL,
  } = env;

  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_PUBLIC_BUCKET ||
    !R2_PRIVATE_BUCKET ||
    !R2_PUBLIC_BASE_URL
  ) {
    // Off Vercel the app boots keyless; env.ts guarantees this is all-or-nothing
    // and that the R2 path is the only one available in production.
    return {
      public: createLocalObjectStorage("public"),
      private: createLocalObjectStorage("private"),
    };
  }

  const credentials = {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
  return {
    public: createR2ObjectStorage({
      ...credentials,
      bucket: R2_PUBLIC_BUCKET,
      publicBaseUrl: R2_PUBLIC_BASE_URL,
    }),
    private: createR2ObjectStorage({
      ...credentials,
      bucket: R2_PRIVATE_BUCKET,
      publicBaseUrl: null,
    }),
  };
}

export function getStorage(): StorageBuckets {
  if (cached === null) {
    // Built into the port here rather than inside each adapter: this is the only place one is
    // chosen, so the key rule and the one reading of a prefix cover every bucket the app can
    // reach and cannot drift between them.
    const buckets = createStorage();
    cached = {
      public: createObjectStorage(buckets.public),
      private: createObjectStorage(buckets.private),
    };
  }
  return cached;
}

/** True when the filesystem adapter is active; drives the dev-only upload route. */
export function isLocalStorage(): boolean {
  return !env.R2_ACCOUNT_ID;
}

export function getPublicStorage(): ObjectStorage {
  return getStorage().public;
}

export function getPrivateStorage(): ObjectStorage {
  return getStorage().private;
}

/** Test-only: lets a suite re-read environment configuration between cases. */
export function resetStorageCache(): void {
  cached = null;
}
