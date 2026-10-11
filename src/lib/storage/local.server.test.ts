import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalObjectStorage, verifyLocalUploadToken } from "./local.server";

// One throwaway bucket for the whole file keeps the assertions isolated without
// reaching into the app's real `.tura/storage` namespace.
const bucket = `test-${randomUUID()}`;
const storage = createLocalObjectStorage(bucket);

beforeAll(async () => {
  await storage.deletePrefix("");
});

afterAll(async () => {
  await storage.deletePrefix("");
});

describe("local object storage", () => {
  it("round-trips an object with its media type", async () => {
    await storage.put("covers/novel-1/seg/480.webp", Uint8Array.from([1, 2, 3]), {
      contentType: "image/webp",
    });

    const object = await storage.get("covers/novel-1/seg/480.webp");
    expect(object?.contentType).toBe("image/webp");
    expect(Buffer.from(object?.bytes ?? [])).toEqual(Buffer.from([1, 2, 3]));
    // A metadata-only read reports size only; the media type comes from the object itself.
    await expect(storage.head("covers/novel-1/seg/480.webp")).resolves.toEqual({ size: 3 });
  });

  it("treats a missing object as absent rather than an error", async () => {
    await expect(storage.get("covers/missing")).resolves.toBeNull();
    await expect(storage.head("covers/missing")).resolves.toBeNull();
    await expect(storage.delete("covers/missing")).resolves.toBeUndefined();
  });

  it("deletes a whole prefix and leaves sibling prefixes alone", async () => {
    await storage.put("covers/novel-2/seg-a/320.webp", Uint8Array.from([1]), {
      contentType: "image/webp",
    });
    await storage.put("covers/novel-2/seg-a/640.webp", Uint8Array.from([1]), {
      contentType: "image/webp",
    });
    await storage.put("covers/novel-2/seg-b/640.webp", Uint8Array.from([1]), {
      contentType: "image/webp",
    });

    await storage.deletePrefix("covers/novel-2/seg-a");

    await expect(storage.head("covers/novel-2/seg-a/320.webp")).resolves.toBeNull();
    await expect(storage.head("covers/novel-2/seg-a/640.webp")).resolves.toBeNull();
    await expect(storage.head("covers/novel-2/seg-b/640.webp")).resolves.not.toBeNull();
  });

  it("refuses keys that could escape the storage root", async () => {
    for (const key of ["../escape", "covers/../../escape", "", "/absolute"]) {
      await expect(
        storage.put(key, Uint8Array.from([1]), { contentType: "text/plain" }),
      ).rejects.toThrow(/Unsafe storage key/);
      await expect(storage.get(key)).rejects.toThrow(/Unsafe storage key/);
    }
  });

  describe("listKeys", () => {
    const root = `avatars/${randomUUID()}`;
    const firstSet = `${root}/user-1/firstphoto`;

    it("lists a nested prefix without the metadata sidecars it writes", async () => {
      for (const key of [
        `${firstSet}/original`,
        `${firstSet}/64.webp`,
        `${root}/user-2/stale/256.webp`,
      ]) {
        await storage.put(key, Uint8Array.from([1]), { contentType: "image/webp" });
      }

      const keys = await storage.listKeys(root);

      // The filesystem adapter has no unreachable-bucket state: a directory that was
      // never written is an empty one, so this is never null.
      expect(keys).not.toBeNull();
      expect(keys).toEqual([
        `${firstSet}/64.webp`,
        `${firstSet}/original`,
        `${root}/user-2/stale/256.webp`,
      ]);
      // Each write pairs the object with a `<key>.meta.json` sidecar, which is this
      // adapter's bookkeeping: a caller that reconciled on it would delete live objects.
      expect(keys?.some((key) => key.endsWith(".meta.json"))).toBe(false);
    });

    it("stops at the prefix a caller asked for", async () => {
      await expect(storage.listKeys(firstSet)).resolves.toEqual([
        `${firstSet}/64.webp`,
        `${firstSet}/original`,
      ]);
    });

    it("answers an empty list for a prefix and for a bucket that holds no objects", async () => {
      await expect(storage.listKeys(`${root}/user-9/no-photo`)).resolves.toEqual([]);
      await expect(storage.listKeys(`absent-${randomUUID()}`)).resolves.toEqual([]);
    });

    it("still lists a key whose own name carries the sidecar suffix", async () => {
      const key = `${root}/user-3/notes.meta.json`;
      await storage.put(key, Uint8Array.from([1]), { contentType: "application/json" });

      await expect(storage.listKeys(`${root}/user-3`)).resolves.toEqual([key]);
      // The sidecar is discriminated from a real key by the object it annotates.
      await expect(storage.get(key)).resolves.toMatchObject({ contentType: "application/json" });
    });

    it("refuses a prefix that could escape the storage root", async () => {
      for (const prefix of ["../escape", "covers/../../escape", "/absolute"]) {
        await expect(storage.listKeys(prefix)).rejects.toThrow(/Unsafe storage key/);
      }
      // No prefix means the whole bucket, which stays inside the storage root.
      await expect(storage.listKeys("")).resolves.toContain(`${firstSet}/original`);
    });
  });

  it("never claims a public URL, so reads stay behind the app proxy", () => {
    expect(storage.publicUrl("covers/novel-1/seg/640.webp")).toBeNull();
  });

  it("issues a signed upload URL for exactly the reserved key", async () => {
    const key = "epub-uploads/upload-1";
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
    const url = new URL(
      await storage.presignPut("epub-uploads/upload-3", {
        contentType: "application/epub+zip",
        expiresIn: 900,
      }),
      "http://localhost:3000",
    );
    const expires = Number(url.searchParams.get("expires")) - 100_000;

    expect(
      verifyLocalUploadToken({
        bucket,
        key: "epub-uploads/upload-3",
        expires,
        signature: url.searchParams.get("signature") ?? "",
      }),
    ).toBe(false);
  });
});
