import { randomUUID } from "node:crypto";
import { utimesSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AVATAR_KEY_ROOT,
  avatarOriginalKey,
  avatarPrefix,
  avatarVariantKey,
  coverObjectKey,
  coverPrefix,
  coverVariantKey,
  epubUploadKey,
  exportKeyPrefix,
  keySetScope,
  WHOLE_BUCKET,
  type KeySetPrefix,
  type ObjectKey,
} from "./keys";
import { createLocalObjectStorage, verifyLocalUploadToken } from "./local.server";

// One throwaway bucket for the whole file keeps the assertions isolated without
// reaching into the app's real `.tura/storage` namespace.
const bucket = `test-${randomUUID()}`;
// The port resolves a prefix into this before the adapter sees it; these cases exercise the
// adapter, so they hand it exactly what the port would.
const storage = createLocalObjectStorage(bucket);
const wholeBucket = keySetScope(WHOLE_BUCKET);

/**
 * A value that arrived as data — a bucket listing, a request parameter, a row written before this
 * layout existed — rather than one the vocabulary built.
 *
 * Every other key in this file is derived, because the adapter takes branded keys and a hand-written
 * path is a cast. That is the point of the brand: the compiler refuses the string at each of the call
 * sites below, so what is left for the adapter's own root check is a value that got past the type
 * anyway — which is exactly what a listing or a hostile request hands it, and what these casts
 * stand in for.
 */
const asObjectKey = (key: string): ObjectKey => key as ObjectKey;
const asKeySetPrefix = (prefix: string): KeySetPrefix => prefix as KeySetPrefix;

/** Where this adapter keeps one key, so a case can reach the file the way the adapter does. */
function storedFile(key: ObjectKey): string {
  return path.join(process.cwd(), ".tura", "storage", bucket, key);
}

beforeAll(async () => {
  await storage.removeSet(wholeBucket);
});

afterAll(async () => {
  await storage.removeSet(wholeBucket);
});

describe("local object storage", () => {
  it("round-trips an object with its media type", async () => {
    const key = coverVariantKey(coverPrefix("novel-1", "segment-1"), 480);

    await storage.put(key, Uint8Array.from([1, 2, 3]), { contentType: "image/webp" });

    const object = await storage.get(key);
    expect(object?.contentType).toBe("image/webp");
    expect(Buffer.from(object?.bytes ?? [])).toEqual(Buffer.from([1, 2, 3]));
    // A metadata-only read reports size only; the media type comes from the object itself.
    await expect(storage.head(key)).resolves.toEqual({ size: 3 });
  });

  it("treats a missing object as absent rather than an error", async () => {
    const key = avatarOriginalKey(avatarPrefix("user-absent", "photo"));

    await expect(storage.get(key)).resolves.toBeNull();
    await expect(storage.head(key)).resolves.toBeNull();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it("deletes a whole prefix and leaves sibling prefixes alone", async () => {
    const first = coverPrefix("novel-2", "segment-a");
    const second = coverPrefix("novel-2", "segment-b");
    await storage.put(coverVariantKey(first, 320), Uint8Array.from([1]), {
      contentType: "image/webp",
    });
    await storage.put(coverVariantKey(first, 640), Uint8Array.from([1]), {
      contentType: "image/webp",
    });
    await storage.put(coverVariantKey(second, 640), Uint8Array.from([1]), {
      contentType: "image/webp",
    });

    await storage.removeSet(keySetScope(first));

    await expect(storage.head(coverVariantKey(first, 320))).resolves.toBeNull();
    await expect(storage.head(coverVariantKey(first, 640))).resolves.toBeNull();
    await expect(storage.head(coverVariantKey(second, 640))).resolves.not.toBeNull();
  });

  it("refuses keys that could escape the storage root", async () => {
    for (const key of ["../escape", "covers/../../escape", "", "/absolute"]) {
      await expect(
        storage.put(asObjectKey(key), Uint8Array.from([1]), { contentType: "text/plain" }),
      ).rejects.toThrow(/Unsafe storage key/);
      await expect(storage.get(asObjectKey(key))).rejects.toThrow(/Unsafe storage key/);
    }
  });

  describe("listing a set", () => {
    const firstSet = avatarPrefix("user-1", "firstphoto");

    it("lists a nested prefix without the metadata sidecars it writes", async () => {
      for (const key of [
        avatarOriginalKey(firstSet),
        avatarVariantKey(firstSet, 64),
        avatarVariantKey(avatarPrefix("user-2", "stale"), 256),
      ]) {
        await storage.put(key, Uint8Array.from([1]), { contentType: "image/webp" });
      }

      const keys = await storage.listSet(keySetScope(AVATAR_KEY_ROOT));

      // The filesystem adapter has no unreachable-bucket state: a directory that was
      // never written is an empty one, so this is never null.
      expect(keys).not.toBeNull();
      expect(keys).toEqual(
        [
          avatarVariantKey(firstSet, 64),
          avatarOriginalKey(firstSet),
          avatarVariantKey(avatarPrefix("user-2", "stale"), 256),
        ].toSorted(),
      );
      // Each write pairs the object with a `<key>.meta.json` sidecar, which is this
      // adapter's bookkeeping: a caller that reconciled on it would delete live objects.
      expect(keys?.some((key) => key.endsWith(".meta.json"))).toBe(false);
    });

    it("reports when each object was written, read from the object itself", async () => {
      const set = coverPrefix("novel-9", "segment-1");
      const backdated = coverVariantKey(set, 320);
      const fresh = coverVariantKey(set, 480);
      await storage.put(backdated, Uint8Array.from([1]), { contentType: "image/webp" });
      await storage.put(fresh, Uint8Array.from([1]), { contentType: "image/webp" });

      // Backdated on disk: a sweep's grace period reads the object's own write time, not the
      // moment the listing happened to run.
      const written = new Date("2020-01-02T03:04:05.000Z");
      utimesSync(storedFile(backdated), written, written);

      const objects = await storage.listObjects(keySetScope(set));

      expect(objects?.map((object) => object.key)).toEqual([backdated, fresh]);
      expect(objects?.find((object) => object.key === backdated)?.lastModified).toEqual(written);
      // The sidecar this adapter writes is bookkeeping, not an object a caller stored.
      expect(objects?.some((object) => object.key.endsWith(".meta.json"))).toBe(false);
    });

    it("stops at the set the caller asked for", async () => {
      await expect(storage.listSet(keySetScope(firstSet))).resolves.toEqual([
        avatarVariantKey(firstSet, 64),
        avatarOriginalKey(firstSet),
      ]);
    });

    it("never reaches a sibling whose name merely starts with the set's characters", async () => {
      const sibling = avatarPrefix("user-1", "firstphoto-archive");
      await storage.put(avatarVariantKey(sibling, 64), Uint8Array.from([1]), {
        contentType: "image/webp",
      });

      await expect(storage.listSet(keySetScope(firstSet))).resolves.toEqual([
        avatarVariantKey(firstSet, 64),
        avatarOriginalKey(firstSet),
      ]);
    });

    it("answers an empty list for a set nothing was written to", async () => {
      await expect(
        storage.listSet(keySetScope(avatarPrefix("user-9", "no-photo"))),
      ).resolves.toEqual([]);
      // A root with no objects at all: the directory was never created.
      await expect(
        storage.listSet(keySetScope(exportKeyPrefix(`novel-${randomUUID()}`))),
      ).resolves.toEqual([]);
    });

    it("still lists a key whose own name carries the sidecar suffix", async () => {
      const key = coverObjectKey(coverPrefix("novel-3", "segment-1"), "notes.meta.json");
      await storage.put(key, Uint8Array.from([1]), { contentType: "application/json" });

      await expect(
        storage.listSet(keySetScope(coverPrefix("novel-3", "segment-1"))),
      ).resolves.toEqual([key]);
      // The sidecar is discriminated from a real key by the object it annotates.
      await expect(storage.get(key)).resolves.toMatchObject({ contentType: "application/json" });
    });

    it("refuses a set name that could escape the storage root", async () => {
      for (const prefix of ["../escape", "covers/../../escape", "/absolute"]) {
        await expect(storage.listSet(keySetScope(asKeySetPrefix(prefix)))).rejects.toThrow(
          /Unsafe storage key/,
        );
      }
    });

    it("opens the whole bucket for the empty set, which stays inside the storage root", async () => {
      await expect(storage.listSet(wholeBucket)).resolves.toContain(avatarOriginalKey(firstSet));
    });
  });

  it("never claims a public URL, so reads stay behind the app proxy", () => {
    expect(storage.publicUrl(coverVariantKey(coverPrefix("novel-1", "segment-1"), 640))).toBeNull();
  });

  it("issues a signed upload URL for exactly the reserved key", async () => {
    const key = epubUploadKey("upload-1");
    // The adapter returns a same-origin path; the browser resolves it against the app.
    const url = new URL(
      await storage.presignPut(key, { contentType: "application/epub+zip", expiresIn: 900 }),
      "http://localhost:3000",
    );

    expect(url.pathname).toBe("/api/storage/upload");
    expect(url.searchParams.get("bucket")).toBe(bucket);
    expect(url.searchParams.get("key")).toBe(key);

    const token = {
      bucket,
      key,
      expires: Number(url.searchParams.get("expires")),
      signature: url.searchParams.get("signature") ?? "",
    };
    expect(verifyLocalUploadToken(token)).toBe(true);
    // A token minted for one key cannot be replayed against another.
    expect(verifyLocalUploadToken({ ...token, key: "epub-uploads/upload-2" })).toBe(false);
    expect(
      verifyLocalUploadToken({ ...token, signature: "0".repeat(token.signature.length) }),
    ).toBe(false);
  });

  it("rejects an expired upload token", async () => {
    const key = epubUploadKey("upload-3");
    const url = new URL(
      await storage.presignPut(key, { contentType: "application/epub+zip", expiresIn: 900 }),
      "http://localhost:3000",
    );
    const expires = Number(url.searchParams.get("expires")) - 100_000;

    expect(
      verifyLocalUploadToken({
        bucket,
        key,
        expires,
        signature: url.searchParams.get("signature") ?? "",
      }),
    ).toBe(false);
  });
});
