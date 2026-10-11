import "@tanstack/react-start/server-only";

import { S3mini, S3ServiceError } from "s3mini";

import type { ObjectStorage, StorageHead, StorageObject, StoragePutOptions } from "./types";

export interface R2ObjectStorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Set only for the publicly served bucket; null keeps URLs app-proxied. */
  publicBaseUrl: string | null;
}

export class StorageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "StorageRequestError";
  }
}

/** The status S3 returns for a key that does not exist. */
const NOT_FOUND = 404;
/** Keys per list page; R2 caps `max-keys` at 1000. */
const LIST_PAGE_SIZE = 1000;
/** Bound on list pages so a runaway prefix cannot spin forever. */
const LIST_MAX_PAGES = 50;

/**
 * `getContentLength` catches the underlying failure and rethrows it as a plain `Error`
 * with the S3 error attached as `cause`, so the status has to be read from the chain.
 */
function httpStatusOf(error: unknown): number | null {
  if (error instanceof S3ServiceError) return error.status;
  if (error instanceof Error && error.cause !== undefined) return httpStatusOf(error.cause);
  return null;
}

/** Keeps the port's error contract: an HTTP failure carries its status, nothing else does. */
function storageError(description: string, error: unknown): unknown {
  const status = httpStatusOf(error);
  if (status === null) return error;
  return new StorageRequestError(`${description} failed with ${status}`, status, { cause: error });
}

async function request<T>(description: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw storageError(description, error);
  }
}

/**
 * `typeof fetch` also carries `preconnect`, which this wrapper never needs. Mirroring it
 * keeps the wrapper structurally a `fetch` instead of asserting a shape it does not have;
 * the delegate is a no-op where the runtime has no such helper, so an optional hint can
 * never turn into a thrown error.
 */
const pinnedFetch: typeof fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  {
    preconnect: (...args: Parameters<typeof fetch.preconnect>) => {
      if (typeof fetch.preconnect === "function") fetch.preconnect(...args);
    },
  },
);

/**
 * Cloudflare R2 over the S3 API, using `s3mini` (zero dependencies, TypeScript).
 *
 * The endpoint is bucket-scoped, as R2 expects: the bucket is part of the URL path.
 *
 * `fetch` is passed explicitly rather than left to default. `s3mini` switches to Bun's
 * native `Bun.S3Client` for reads, listings, deletes and presigning when it is handed the
 * real `globalThis.fetch` and the runtime is Bun. That fast path only exists locally: this
 * app deploys as a Node server, so leaving it enabled would let development and production
 * run different code, and would put reads and listings outside `fetch` stubs in tests.
 * The wrapper defeats the detection while still resolving the global at request time, so
 * one signed implementation runs everywhere and stays observable.
 */
export function createR2ObjectStorage(config: R2ObjectStorageConfig): ObjectStorage {
  const client = new S3mini({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`,
    fetch: pinnedFetch,
  });

  /** Lists every key under a prefix, bounded to the configured page ceiling. */
  async function listKeys(prefix: string): Promise<string[] | null> {
    const keys: string[] = [];
    let token: string | undefined;

    for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
      const listed = await request(`R2 LIST ${prefix}`, () =>
        client.listObjectsPaged("/", prefix, LIST_PAGE_SIZE, token),
      );
      // A null result means the bucket itself is missing; an empty bucket lists as [].
      if (!listed || !listed.objects) return null;
      for (const object of listed.objects) keys.push(object.Key);
      token = listed.nextContinuationToken;
      if (!token) break;
    }

    return keys;
  }

  return {
    async put(key: string, bytes: Uint8Array, options: StoragePutOptions) {
      const response = await request(`R2 PUT ${key}`, () =>
        client.putObject(key, bytes, options.contentType),
      );
      // `putObject` tolerates only 200 and throws otherwise, but never assume it.
      if (!response.ok) {
        throw new StorageRequestError(
          `R2 PUT ${key} failed with ${response.status}`,
          response.status,
        );
      }
    },

    async get(key: string): Promise<StorageObject | null> {
      const response = await request(`R2 GET ${key}`, () => client.getObjectResponse(key));
      if (!response) return null;
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get("content-type"),
      };
    },

    async head(key: string): Promise<StorageHead | null> {
      try {
        return { size: await client.getContentLength(key) };
      } catch (error) {
        if (httpStatusOf(error) === NOT_FOUND) return null;
        throw storageError(`R2 HEAD ${key}`, error);
      }
    },

    async delete(key: string) {
      await request(`R2 DELETE ${key}`, () => client.deleteObject(key));
    },

    async deletePrefix(prefix: string) {
      const keys = await listKeys(prefix);
      if (keys === null || keys.length === 0) return;
      // `deleteObjects` batches at 1000 keys per request.
      await request(`R2 DELETE ${prefix}`, () => client.deleteObjects(keys));
    },

    async presignPut(key, { expiresIn }) {
      // Signs the host and expiry only, so the URL writes exactly one key and cannot be
      // replayed elsewhere. The media type travels unsigned, as the browser sends it.
      return request(`R2 PRESIGN ${key}`, () => client.getPresignedUrl("PUT", key, expiresIn));
    },

    publicUrl(key: string) {
      if (!config.publicBaseUrl) return null;
      return `${config.publicBaseUrl}/${encodeObjectPath(key)}`;
    },
  };
}

/** Percent-encodes each path segment without touching the separators. */
function encodeObjectPath(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
