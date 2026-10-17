import { beforeEach, describe, expect, it } from "vitest";

import { getStorage, resetStorageCache } from "./index.server";
import {
  avatarOriginalKey,
  avatarPrefix,
  avatarVariantKey,
  coverOriginalKey,
  coverPrefix,
  coverVariantKey,
  epubUploadKey,
  exportObjectKey,
  isObjectKeyPrefix,
  type KeySetPrefix,
  type KeySetScope,
  type ObjectKey,
} from "./keys";
import { createObjectStorage } from "./port";
import type {
  ObjectStorage,
  ObjectStorageBackend,
  StorageHead,
  StorageObject,
  StoragePutOptions,
} from "./types";

/**
 * A transport that records what reached it. The point of every refusal below is that this
 * stays empty: a key the vocabulary does not derive must be rejected *before* the adapter,
 * which is the difference between a failed call and an object in a bucket.
 */
function recordingStorage() {
  const calls: Array<{ op: string; value: string }> = [];
  const sets: Array<{ op: string; scope: KeySetScope }> = [];
  const record = (op: string, value: string) => {
    calls.push({ op, value });
  };

  const storage: ObjectStorageBackend = {
    async put(key, _bytes: Uint8Array, _options: StoragePutOptions) {
      record("put", key);
    },
    async get(key): Promise<StorageObject | null> {
      record("get", key);
      return null;
    },
    async head(key): Promise<StorageHead | null> {
      record("head", key);
      return null;
    },
    async delete(key) {
      record("delete", key);
    },
    async removeSet(scope) {
      sets.push({ op: "removeSet", scope });
    },
    async listSet(scope) {
      sets.push({ op: "listSet", scope });
      return [];
    },
    async listObjects(scope) {
      sets.push({ op: "listObjects", scope });
      return [];
    },
    async presignPut(key) {
      record("presignPut", key);
      return "https://storage.test/upload";
    },
    publicUrl(key) {
      record("publicUrl", key);
      return `https://cdn.test/${key}`;
    },
  };

  return { calls, sets, storage };
}

/**
 * Every method that reaches the bucket, so a new one cannot arrive unguarded and unnoticed.
 * `publicUrl` is missing on purpose: it derives a URL and is left unguarded so a malformed
 * key on a row degrades to a missing image instead of failing the page that renders it.
 */
const KEY_OPERATIONS = [
  [
    "put",
    (storage: ObjectStorage, key: ObjectKey) =>
      storage.put(key, Uint8Array.from([1]), { contentType: "image/webp" }),
  ],
  ["get", (storage: ObjectStorage, key: ObjectKey) => storage.get(key)],
  ["head", (storage: ObjectStorage, key: ObjectKey) => storage.head(key)],
  ["delete", (storage: ObjectStorage, key: ObjectKey) => storage.delete(key)],
  [
    "presignPut",
    (storage: ObjectStorage, key: ObjectKey) =>
      storage.presignPut(key, { contentType: "application/epub+zip", expiresIn: 900 }),
  ],
] as const;

const PREFIX_OPERATIONS = [
  ["deletePrefix", (storage: ObjectStorage, prefix: KeySetPrefix) => storage.deletePrefix(prefix)],
  ["listKeys", (storage: ObjectStorage, prefix: KeySetPrefix) => storage.listKeys(prefix)],
  ["listObjects", (storage: ObjectStorage, prefix: KeySetPrefix) => storage.listObjects(prefix)],
] as const;

/**
 * The port's name for a prefix operation against the adapter's own. `listKeys` and `listObjects`
 * resolve the same set through the same reading and differ only in what the adapter reports back, so
 * what these cases check — that a prefix is read once, before any adapter — has to hold for both.
 */
const BACKEND_OPERATION: Record<(typeof PREFIX_OPERATIONS)[number][0], string> = {
  deletePrefix: "removeSet",
  listKeys: "listSet",
  listObjects: "listObjects",
};

/**
 * The keys the port must pass through untouched, built by the vocabulary rather than written out.
 *
 * Spelling them by hand would be the very thing the brand now refuses at a call site, so a case that
 * wants a key it expects to be admitted asks the builder that derives it. Which path each builder
 * produces is `keys.test.ts`'s business; what this file checks is that a derived value reaches the
 * adapter as itself and an underived one never reaches it at all.
 */
const DERIVED_KEYS: ObjectKey[] = [
  coverOriginalKey(coverPrefix("novel-1", "segment-1")),
  coverVariantKey(coverPrefix("novel-1", "segment-1"), 640),
  avatarOriginalKey(avatarPrefix("user-1", "photo")),
  avatarVariantKey(avatarPrefix("user-1", "photo"), 64),
  exportObjectKey("novel-1", "abc123", "txt"),
  exportObjectKey("novel-1", "abc123", "epub"),
  epubUploadKey("upload-1"),
];

/** Shapes the app never writes: close to a real key, a root that is only similar, a path. */
const UNDERIVED_KEYS = [
  "",
  "covers",
  "covers/novel-1",
  "covers/novel-1/segment-1",
  "covers/only-two-parts",
  "covers/novel-1/segment-1/640.webp/extra",
  "covers//segment-1/640.webp",
  "avatars/user-1",
  "avatars/user-1/photo",
  "exports/novel-1",
  "exports/novel-1/abc123",
  "epub-uploads",
  "epub-uploads/upload-1/extra",
  "covers-archive/novel-1/segment-1/640.webp",
  "notes.txt",
  "../escape",
  "/absolute",
];

/**
 * Reads a fixture back the way the app reads a stored or listed value, which is the one door from a
 * string into the type the port takes.
 *
 * A cast would do the same thing and prove nothing, so a fixture that is not a set the vocabulary
 * derives fails here instead.
 */
function derivedPrefix(value: string): KeySetPrefix {
  if (!isObjectKeyPrefix(value)) {
    throw new Error(`test fixture is not a key set the vocabulary derives: "${value}"`);
  }
  return value;
}

/**
 * A value that arrived as data: a row, a bucket listing, a request parameter, or a caller from
 * outside this application's TypeScript.
 *
 * The port takes branded keys, so a cast is the only way to reach it with a string at all — which is
 * exactly what the runtime check is for, and what every case below that hands it a bad key exercises.
 */
const asObjectKey = (value: string): ObjectKey => value as ObjectKey;
const asKeySetPrefix = (value: string): KeySetPrefix => value as KeySetPrefix;

/**
 * What the port must hand an adapter: the set's own name and the boundary a store that
 * matches raw string prefixes works on. Written out rather than re-derived, so the
 * expectation cannot move with the code it checks — and `covers` next to `covers/` pins
 * that both spellings of one set resolve to one scope, which is the property that used to
 * live in each adapter's own normalisation.
 */
const DERIVED_PREFIX_SCOPES: Array<
  [prefix: KeySetPrefix, scope: { name: string; boundary: string }]
> = [
  [derivedPrefix(""), { name: "", boundary: "" }],
  [derivedPrefix("covers"), { name: "covers", boundary: "covers/" }],
  [derivedPrefix("covers/"), { name: "covers", boundary: "covers/" }],
  [derivedPrefix("covers/novel-1"), { name: "covers/novel-1", boundary: "covers/novel-1/" }],
  [
    derivedPrefix("covers/novel-1/segment-1/"),
    { name: "covers/novel-1/segment-1", boundary: "covers/novel-1/segment-1/" },
  ],
  [
    derivedPrefix("avatars/user-1/photo"),
    { name: "avatars/user-1/photo", boundary: "avatars/user-1/photo/" },
  ],
  [derivedPrefix("exports/novel-1"), { name: "exports/novel-1", boundary: "exports/novel-1/" }],
  [
    derivedPrefix("epub-uploads/upload-1"),
    { name: "epub-uploads/upload-1", boundary: "epub-uploads/upload-1/" },
  ],
];

const UNDERIVED_PREFIXES = [
  "avatars/user-1",
  "avatars/user-1/photo/64.webp",
  "covers/novel-1/segment-1/640.webp",
  "../escape",
  "/absolute",
  "covers-archive",
  "notes.txt",
];

let harness: ReturnType<typeof recordingStorage>;

beforeEach(() => {
  harness = recordingStorage();
});

describe("the storage port", () => {
  it.each(KEY_OPERATIONS)(
    "refuses an underived key before %s reaches the adapter",
    async (_op, call) => {
      const storage = createObjectStorage(harness.storage);

      for (const key of UNDERIVED_KEYS) {
        await expect(call(storage, asObjectKey(key))).rejects.toThrow(/Unsafe storage key/);
      }

      expect(harness.calls).toEqual([]);
    },
  );

  it.each(KEY_OPERATIONS)("passes a derived key through %s unchanged", async (op, call) => {
    const storage = createObjectStorage(harness.storage);

    for (const key of DERIVED_KEYS) {
      await call(storage, key);
    }

    expect(harness.calls).toEqual(DERIVED_KEYS.map((key) => ({ op, value: key })));
  });

  it.each(PREFIX_OPERATIONS)(
    "refuses an underived prefix before %s resolves anything",
    async (_op, call) => {
      const storage = createObjectStorage(harness.storage);

      for (const prefix of UNDERIVED_PREFIXES) {
        await expect(call(storage, asKeySetPrefix(prefix))).rejects.toThrow(/Unsafe storage key/);
      }

      expect(harness.sets).toEqual([]);
    },
  );

  it.each(PREFIX_OPERATIONS)(
    "resolves a derived prefix for %s into the set's own scope",
    async (op, call) => {
      const storage = createObjectStorage(harness.storage);

      for (const [prefix] of DERIVED_PREFIX_SCOPES) {
        await call(storage, prefix);
      }

      expect(harness.sets).toEqual(
        DERIVED_PREFIX_SCOPES.map(([, scope]) => ({
          op: BACKEND_OPERATION[op],
          scope,
        })),
      );
    },
  );

  it("reads a prefix once, so a set cannot mean one thing to one adapter and another to the next", async () => {
    const forDelete = createObjectStorage(harness.storage);
    const forListing = createObjectStorage(harness.storage);

    await forDelete.deletePrefix(derivedPrefix("avatars/user-1/photo"));
    await forListing.listKeys(derivedPrefix("avatars/user-1/photo/"));

    // One set, two spellings, two operations — and one scope, because both read through
    // the same resolution rather than each adapter normalising for itself.
    expect(harness.sets).toEqual([
      {
        op: "removeSet",
        scope: { name: "avatars/user-1/photo", boundary: "avatars/user-1/photo/" },
      },
      { op: "listSet", scope: { name: "avatars/user-1/photo", boundary: "avatars/user-1/photo/" } },
    ]);
  });

  it("names the key it refused, so the caller can find the line that built it", async () => {
    const storage = createObjectStorage(harness.storage);

    await expect(storage.get(asObjectKey("covers/only-two-parts"))).rejects.toThrow(
      'Unsafe storage key: "covers/only-two-parts" is not a shape the key vocabulary derives',
    );
    await expect(storage.listKeys(asKeySetPrefix("avatars/user-1"))).rejects.toThrow(
      'Unsafe storage key prefix: "avatars/user-1" is not a set the key vocabulary derives',
    );
  });

  it("refuses through a rejection, so a .catch() path handles it instead of escaping", async () => {
    const storage = createObjectStorage(harness.storage);
    let caught: unknown = null;

    // Exactly the shape the app writes on paths where a failure is expected.
    await storage.delete(asObjectKey("covers/only-two-parts")).catch((error: unknown) => {
      caught = error;
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Unsafe storage key/);
    expect(harness.calls).toEqual([]);
  });

  it("leaves publicUrl ungated, so a malformed row degrades to a missing image", async () => {
    const storage = createObjectStorage(harness.storage);

    expect(storage.publicUrl(asObjectKey("covers/only-two-parts"))).toBe(
      "https://cdn.test/covers/only-two-parts",
    );
    expect(harness.calls).toEqual([{ op: "publicUrl", value: "covers/only-two-parts" }]);
  });
});

describe("the buckets the app selects", () => {
  it("builds both of them on the port, whichever adapter is configured", async () => {
    resetStorageCache();
    const buckets = getStorage();

    // The guard runs before any adapter, so this refuses without a request whichever
    // adapter was chosen — and no valid call is made here to avoid touching a real bucket.
    for (const storage of [buckets.public, buckets.private]) {
      await expect(
        storage.put(asObjectKey("covers/only-two-parts"), Uint8Array.from([1]), {
          contentType: "image/webp",
        }),
      ).rejects.toThrow(/Unsafe storage key/);
      await expect(storage.deletePrefix(asKeySetPrefix("avatars/user-1"))).rejects.toThrow(
        /Unsafe storage key/,
      );
    }
  });
});
