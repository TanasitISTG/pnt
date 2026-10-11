import { describe, expect, it, vi } from "vitest";

import { selectOrphanAvatarPrefixes, sweepOrphanAvatars } from "./avatar-sweep";

const REFERENCED = "avatars/user-1/firstphoto";
const ORPHAN = "avatars/user-2/stalenphoto";
const OTHER_ORPHAN = "avatars/user-3/stalenphoto";

/** A bucket that behaves like the real one: prefix matching, and no closed set of keys. */
function memoryStorage(initialKeys: readonly string[]) {
  const keys = new Set(initialKeys);
  return {
    keys,
    api: {
      async listKeys(prefix: string) {
        return [...keys].filter((key) => key.startsWith(prefix)).toSorted();
      },
      async deletePrefix(prefix: string) {
        // Deleting from a Set during iteration is safe: removed entries are simply
        // not revisited.
        for (const key of keys) {
          if (key.startsWith(prefix)) keys.delete(key);
        }
      },
    },
  };
}

function objectKeys(prefix: string) {
  return [`${prefix}/original`, `${prefix}/64.webp`, `${prefix}/128.webp`, `${prefix}/256.webp`];
}

describe("selectOrphanAvatarPrefixes", () => {
  it("groups a set's objects into one prefix and keeps the referenced one", () => {
    const { orphanPrefixes, unrecognized } = selectOrphanAvatarPrefixes(
      [...objectKeys(REFERENCED), ...objectKeys(ORPHAN), ...objectKeys(OTHER_ORPHAN)],
      new Set([REFERENCED]),
    );

    expect(orphanPrefixes).toEqual([ORPHAN, OTHER_ORPHAN]);
    expect(unrecognized).toBe(0);
  });

  it("refuses to treat anything but a whole avatar set as deletable", () => {
    const { orphanPrefixes, unrecognized } = selectOrphanAvatarPrefixes(
      [
        // A cover set and other private objects are never candidates, even unreferenced.
        "covers/novel-1/segment/640.webp",
        "epub-uploads/upload-1",
        "exports/novel-1/abc123.epub",
        // Under the avatar root but not the shape a row can store.
        "avatars/user-1",
        "avatars/user-1/firstphoto",
        "avatars/notes.txt",
        "avatars-archive/user-1/segment/640.webp",
      ],
      new Set(),
    );

    expect(orphanPrefixes).toEqual([]);
    expect(unrecognized).toBe(7);
  });
});

describe("sweepOrphanAvatars", () => {
  it("deletes only the sets no row points at, leaving the referenced bytes in place", async () => {
    const storage = memoryStorage([
      ...objectKeys(REFERENCED),
      ...objectKeys(ORPHAN),
      // Sits in the same bucket and is never in scope for this sweep.
      "covers/novel-1/segment/640.webp",
    ]);

    const result = await sweepOrphanAvatars(storage.api, async () => new Set([REFERENCED]), {
      dryRun: false,
    });

    expect(result.orphanPrefixes).toEqual([ORPHAN]);
    expect(result.deletedPrefixes).toEqual([ORPHAN]);
    expect(result.failures).toEqual([]);
    for (const key of objectKeys(REFERENCED)) {
      await expect(storage.keys.has(key)).toBe(true);
    }
    expect(storage.keys.has("covers/novel-1/segment/640.webp")).toBe(true);
    expect([...storage.keys].some((key) => key.startsWith(`${ORPHAN}/`))).toBe(false);
  });

  it("reports every orphan and lets a dry run touch nothing", async () => {
    const storage = memoryStorage([...objectKeys(REFERENCED), ...objectKeys(ORPHAN)]);
    const readReferenced = vi.fn(async () => new Set([REFERENCED]));

    const result = await sweepOrphanAvatars(storage.api, readReferenced, { dryRun: true });

    expect(result.orphanPrefixes).toEqual([ORPHAN]);
    expect(result.deletedPrefixes).toEqual([]);
    expect(storage.keys.size).toBe(8);
    // The preview stops at the plan, so it reads the rows once and issues no delete.
    expect(readReferenced).toHaveBeenCalledTimes(1);
  });

  it("refuses to sweep a bucket it could not list", async () => {
    const storage = memoryStorage(objectKeys(ORPHAN));
    const readReferenced = vi.fn(async () => new Set<string>());

    await expect(
      sweepOrphanAvatars(
        { listKeys: async () => null, deletePrefix: storage.api.deletePrefix },
        readReferenced,
        { dryRun: false },
      ),
    ).rejects.toThrow("The public bucket could not be listed; nothing was deleted.");

    // An empty listing from a bucket that failed to answer is not evidence of orphans.
    expect(storage.keys.size).toBe(4);
    expect(readReferenced).not.toHaveBeenCalled();
  });

  it("keeps a set that became referenced while the listing was in flight", async () => {
    const storage = memoryStorage(objectKeys(ORPHAN));
    const reads = [new Set<string>(), new Set([ORPHAN])];
    const readReferenced = vi.fn(async () => reads.shift() ?? new Set([ORPHAN]));

    const result = await sweepOrphanAvatars(storage.api, readReferenced, { dryRun: false });

    expect(result.referencedSinceListing).toEqual([ORPHAN]);
    expect(result.deletedPrefixes).toEqual([]);
    expect(storage.keys.size).toBe(4);
  });

  it("reports a delete that failed and still removes the sets after it", async () => {
    const storage = memoryStorage([
      ...objectKeys(ORPHAN),
      ...objectKeys(OTHER_ORPHAN),
      "avatars/user-4/stalenphoto/256.webp",
    ]);

    const result = await sweepOrphanAvatars(
      {
        listKeys: storage.api.listKeys,
        async deletePrefix(prefix: string) {
          // Keys sort, so the refused set is attempted before the successful ones.
          if (prefix === "avatars/user-4/stalenphoto") throw new Error("503 from the bucket");
          await storage.api.deletePrefix(prefix);
        },
      },
      async () => new Set<string>(),
      { dryRun: false },
    );

    expect(result.deletedPrefixes).toEqual([ORPHAN, OTHER_ORPHAN]);
    expect(result.failures).toEqual([
      { prefix: "avatars/user-4/stalenphoto", message: "503 from the bucket" },
    ]);
    expect(storage.keys.has("avatars/user-4/stalenphoto/256.webp")).toBe(true);
  });

  it("is a no-op on a clean database", async () => {
    const storage = memoryStorage(objectKeys(REFERENCED));

    const result = await sweepOrphanAvatars(storage.api, async () => new Set([REFERENCED]), {
      dryRun: false,
    });

    expect(result).toMatchObject({
      scanned: 4,
      unrecognized: 0,
      orphanPrefixes: [],
      deletedPrefixes: [],
      failures: [],
    });
    expect(storage.keys.size).toBe(4);
  });
});
