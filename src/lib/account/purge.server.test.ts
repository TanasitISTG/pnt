import { describe, expect, it, vi } from "vitest";

import { exportCacheKey, type ChapterRevisionStats } from "../export/stream";
import {
  coverPrefix,
  coverVariantKey,
  epubUploadKey,
  exportObjectKey,
  WHOLE_BUCKET,
  type ObjectKey,
} from "../storage/keys";
import { createLocalObjectStorage } from "../storage/local.server";
import { createObjectStorage } from "../storage/port";
import type { StorageObjectEntry } from "../storage/types";

/**
 * The reconciliation runs against the real filesystem adapter rather than a fake.
 *
 * Its whole job is to hand a set to storage, so a fake that startsWith-matches would accept a prefix
 * the adapter itself refuses — which is exactly how this path used to fail: it spelled the set
 * `covers/<novelId>/`, and the filesystem adapter rejected the trailing separator every time.
 */
const buckets = vi.hoisted(() => ({
  public: `purge-public-${crypto.randomUUID()}`,
  private: `purge-private-${crypto.randomUUID()}`,
}));

interface NovelRow {
  coverKey: string | null;
  title: string;
  author: string | null;
  targetLang: string;
}

interface ChapterStatsRow extends ChapterRevisionStats {
  /** How many chapters the route would consider exportable; zero means the novel has no export. */
  exportableChapters: number;
}

/** The rows both rules read: the novels that survive, their chapter aggregates, the staged archives. */
const rows = vi.hoisted(() => ({
  novels: new Map<string, NovelRow>(),
  chapters: new Map<string, ChapterStatsRow>(),
  uploads: new Set<string>(),
}));

vi.mock("@/lib/db", async () => {
  const { chapters, epubUploads, novels } = await import("@/lib/db/schema");

  /**
   * The rows one query would answer with.
   *
   * A shape naming a single column is this suite's stand-in for an existence or eligibility list —
   * the orphan prune's `{ id }` and the export rule's "has something translated" — so it reads as a
   * filter over the same rows a fuller select returns. Everything else is a row per entry.
   */
  function rowsFor(table: unknown, shape: Record<string, unknown>): unknown[] {
    if (table === novels) {
      if (Object.keys(shape).length === 1) return [...rows.novels.keys()].map((id) => ({ id }));
      return [...rows.novels].map(([id, novel]) => ({ id, ...novel }));
    }
    if (table === chapters) {
      if (Object.keys(shape).length === 1) {
        return [...rows.chapters].flatMap(([novelId, stats]) =>
          stats.exportableChapters > 0 ? [{ novelId }] : [],
        );
      }
      return [...rows.chapters].map(([novelId, stats]) => ({ novelId, ...stats }));
    }
    if (table === epubUploads) return [...rows.uploads].map((objectKey) => ({ objectKey }));
    return [];
  }

  /**
   * Drizzle's chain, as a promise that answers the same rows however it is read.
   *
   * A real promise with the query methods attached, rather than an object that mimics one: the code
   * under test awaits it in both shapes — `await select(...).from(t)` and
   * `await select(...).from(t).where(...).groupBy(...)` — and a genuine promise cannot be mistaken for
   * a half-implemented one.
   */
  interface Chain extends Promise<unknown[]> {
    where: () => Chain;
    groupBy: () => Chain;
    orderBy: () => Chain;
    limit: () => Chain;
  }

  const query = (table: unknown, shape: Record<string, unknown>): Chain =>
    Object.assign(Promise.resolve(rowsFor(table, shape)), {
      where: () => query(table, shape),
      groupBy: () => query(table, shape),
      orderBy: () => query(table, shape),
      limit: () => query(table, shape),
    });

  return {
    db: {
      select: (shape: Record<string, unknown>) => ({
        from: (table: unknown) => query(table, shape),
      }),
    },
  };
});

vi.mock("@/lib/storage/index.server", async () => {
  // The real stack: the filesystem adapter built into the port, as the selection point does.
  const { createLocalObjectStorage: create } = await import("../storage/local.server");
  const { createObjectStorage: port } = await import("../storage/port");
  const publicBucket = port(create(buckets.public));
  const privateBucket = port(create(buckets.private));
  return {
    getStorage: () => ({ public: publicBucket, private: privateBucket }),
    getPublicStorage: () => publicBucket,
    getPrivateStorage: () => privateBucket,
    isLocalStorage: () => true,
    resetStorageCache: () => {},
  };
});

const {
  planSupersededRemovals,
  pruneOrphanNovelAssets,
  reapSupersededAssets,
  selectOrphanAssetOwners,
} = await import("./purge.server");

const publicBackend = createLocalObjectStorage(buckets.public);
const privateBackend = createLocalObjectStorage(buckets.private);
const publicStorage = createObjectStorage(publicBackend);
const privateStorage = createObjectStorage(privateBackend);

async function seed(key: ObjectKey, bucket: "public" | "private" = "public"): Promise<void> {
  const storage = bucket === "public" ? publicStorage : privateStorage;
  await storage.put(key, Uint8Array.from([1, 2, 3]), { contentType: "image/webp" });
}

async function exists(key: ObjectKey, bucket: "public" | "private" = "public"): Promise<boolean> {
  const storage = bucket === "public" ? publicStorage : privateStorage;
  return (await storage.head(key)) !== null;
}

/**
 * Places an object no builder derives, and reads it back the same way.
 *
 * Such a key can only be in a bucket because it predates the layout rule — which is exactly what
 * this reconciliation has to leave alone — so it reaches the adapter through a cast, standing in for
 * the listing that reported it: a bucket holds whatever was written to it, and only a value the
 * vocabulary reads back gets acted on.
 */
const asObjectKey = (key: string): ObjectKey => key as ObjectKey;

async function seedStray(key: string, bucket: "public" | "private" = "public"): Promise<void> {
  const backend = bucket === "public" ? publicBackend : privateBackend;
  await backend.put(asObjectKey(key), Uint8Array.from([1, 2, 3]), { contentType: "image/webp" });
}

async function existsStray(key: string, bucket: "public" | "private" = "public"): Promise<boolean> {
  const backend = bucket === "public" ? publicBackend : privateBackend;
  return (await backend.head(asObjectKey(key))) !== null;
}

function novelRow(id: string, coverKey: string | null = null): NovelRow {
  return { coverKey, title: `Novel ${id}`, author: null, targetLang: "th" };
}

/** One object as a listing reports it, for the cases that decide on age alone. */
const at = (key: string, lastModified: Date): StorageObjectEntry => ({ key, lastModified });

function chapterStats(overrides: Partial<ChapterStatsRow> = {}): ChapterStatsRow {
  return {
    chapterCount: 3,
    maxChapterUpdatedAt: new Date("2026-09-01T00:00:00.000Z"),
    maxTranslationGeneration: 2,
    exportableChapters: 3,
    ...overrides,
  };
}

async function reset(): Promise<void> {
  await publicStorage.deletePrefix(WHOLE_BUCKET);
  await privateStorage.deletePrefix(WHOLE_BUCKET);
  rows.novels.clear();
  rows.chapters.clear();
  rows.uploads.clear();
}

describe("selectOrphanAssetOwners", () => {
  it("groups keys by owner and never claims a shape it cannot read", () => {
    const keys = [
      "covers/novel-1/segment/640.webp",
      "covers/novel-2/segment/640.webp",
      "covers/novel-2/segment/original",
      "covers/only-two-parts",
      "covers-archive/novel-3/segment/640.webp",
    ];

    const plan = selectOrphanAssetOwners(keys, "cover", new Set(["novel-1"]));

    // `novel-2` is orphaned once, however many objects it wrote; the two-part key and
    // the sibling root are counted as unrecognized rather than attributed to an owner.
    expect(plan.orphanOwnerIds).toEqual(["novel-2"]);
    expect(plan.unrecognized).toBe(2);
  });
});

describe("pruneOrphanNovelAssets", () => {
  it("removes a deleted novel's covers and exports and leaves everything else", async () => {
    await reset();
    rows.novels.set("novel-1", novelRow("novel-1"));
    rows.novels.set("novel-20", novelRow("novel-20"));

    await seed(coverVariantKey(coverPrefix("novel-1", "segment"), 640));
    await seed(coverVariantKey(coverPrefix("novel-20", "segment"), 640));
    await seed(coverVariantKey(coverPrefix("novel-2", "first"), 640));
    await seed(coverVariantKey(coverPrefix("novel-2", "second"), 640));
    await seedStray("covers/only-two-parts");
    await seedStray("covers-archive/novel-2/segment/640.webp");
    await seed(exportObjectKey("novel-1", "revision", "epub"), "private");
    await seed(exportObjectKey("novel-2", "revision", "epub"), "private");

    const result = await pruneOrphanNovelAssets();

    expect(result.deleted).toEqual(["covers/novel-2", "exports/novel-2"]);
    // Nothing failed: the adapter accepted the prefix the reconciliation derived.
    expect(result.failures).toEqual([]);
    // Three owners were listed under the cover root: the two novels that survive and
    // the one that does not. The two-part key names no owner, and the sibling root was
    // never listed at all.
    expect(result.coveredOwners).toBe(3);
    expect(result.orphanCoverOwners).toBe(1);
    expect(result.orphanExportOwners).toBe(1);

    // A prefix is the whole set, and only that set: both segments go, the novel whose id
    // merely starts with `novel-2` stays, and a sibling root was never even listed.
    await expect(exists(coverVariantKey(coverPrefix("novel-2", "first"), 640))).resolves.toBe(
      false,
    );
    await expect(exists(coverVariantKey(coverPrefix("novel-2", "second"), 640))).resolves.toBe(
      false,
    );
    await expect(exists(coverVariantKey(coverPrefix("novel-20", "segment"), 640))).resolves.toBe(
      true,
    );
    await expect(exists(coverVariantKey(coverPrefix("novel-1", "segment"), 640))).resolves.toBe(
      true,
    );
    await expect(existsStray("covers/only-two-parts")).resolves.toBe(true);
    await expect(existsStray("covers-archive/novel-2/segment/640.webp")).resolves.toBe(true);
    await expect(exists(exportObjectKey("novel-2", "revision", "epub"), "private")).resolves.toBe(
      false,
    );
    await expect(exists(exportObjectKey("novel-1", "revision", "epub"), "private")).resolves.toBe(
      true,
    );
  });

  it("reports a clean pass when the bucket holds nothing to reconcile", async () => {
    await reset();

    const result = await pruneOrphanNovelAssets();

    expect(result).toEqual({
      coveredOwners: 0,
      orphanCoverOwners: 0,
      orphanExportOwners: 0,
      deleted: [],
      failures: [],
    });
  });
});

describe("planSupersededRemovals", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  /** Older than the grace period: a set this old cannot be an upload in flight. */
  const established = new Date("2026-10-01T00:00:00.000Z");
  /** Written moments ago, which is what a replacement mid-flight looks like. */
  const inFlight = new Date("2026-10-16T11:59:00.000Z");

  function input(overrides: Partial<Parameters<typeof planSupersededRemovals>[0]> = {}) {
    return {
      coverObjects: [],
      exportObjects: [],
      uploadObjects: [],
      liveNovels: new Map<string, string | null>(),
      currentExportKeys: new Set<string>(),
      knownUploadKeys: new Set<string>(),
      now,
      ...overrides,
    };
  }

  it("reaps the segments a novel stopped naming and keeps the one its row names", () => {
    const live = coverPrefix("novel-1", "new");
    const superseded = coverPrefix("novel-1", "old");

    const plan = planSupersededRemovals(
      input({
        coverObjects: [
          at(coverVariantKey(live, 640), established),
          at(coverVariantKey(superseded, 640), established),
          at(coverVariantKey(superseded, 320), established),
        ],
        liveNovels: new Map([["novel-1", live]]),
      }),
    );

    expect(plan.coverSets).toEqual([
      {
        set: superseded,
        objects: [coverVariantKey(superseded, 320), coverVariantKey(superseded, 640)].toSorted(),
      },
    ]);
    expect(plan.tooFresh).toBe(0);
  });

  it("reaps every segment of a novel whose cover was removed", () => {
    const plan = planSupersededRemovals(
      input({
        coverObjects: [at(coverVariantKey(coverPrefix("novel-1", "old"), 640), established)],
        liveNovels: new Map([["novel-1", null]]),
      }),
    );

    expect(plan.coverSets.map((entry) => entry.set)).toEqual([coverPrefix("novel-1", "old")]);
  });

  it("leaves a superseded set whole while any object of it could be in flight", () => {
    const superseded = coverPrefix("novel-1", "old");

    const plan = planSupersededRemovals(
      input({
        coverObjects: [
          at(coverVariantKey(superseded, 640), inFlight),
          at(coverVariantKey(superseded, 320), established),
        ],
        liveNovels: new Map([["novel-1", coverPrefix("novel-1", "new")]]),
      }),
    );

    expect(plan.coverSets).toEqual([]);
    expect(plan.tooFresh).toBe(2);
  });

  it("leaves a deleted novel's sets to the orphan prune", () => {
    const plan = planSupersededRemovals(
      input({
        coverObjects: [at(coverVariantKey(coverPrefix("novel-gone", "seg"), 640), established)],
        exportObjects: [at(exportObjectKey("novel-gone", "abc123", "epub"), established)],
      }),
    );

    expect(plan.coverSets).toEqual([]);
    expect(plan.exportKeys).toEqual([]);
    expect(plan.tooFresh).toBe(0);
  });

  it("reaps the export revisions the content moved past and keeps the current key", () => {
    const current = exportObjectKey("novel-1", "abc123", "epub");
    const superseded = exportObjectKey("novel-1", "older4", "txt");

    const plan = planSupersededRemovals(
      input({
        exportObjects: [at(current, established), at(superseded, established)],
        liveNovels: new Map([["novel-1", null]]),
        currentExportKeys: new Set([current]),
      }),
    );

    expect(plan.exportKeys).toEqual([superseded]);
  });

  it("leaves a superseded export revision younger than the grace period", () => {
    const superseded = exportObjectKey("novel-1", "older4", "txt");

    const plan = planSupersededRemovals(
      input({
        exportObjects: [at(superseded, inFlight)],
        liveNovels: new Map([["novel-1", null]]),
      }),
    );

    expect(plan.exportKeys).toEqual([]);
    expect(plan.tooFresh).toBe(1);
  });

  it("reaps a staged archive no upload row names and keeps one a row names", () => {
    const orphan = epubUploadKey("upload-orphan");
    const staged = epubUploadKey("upload-staged");

    const plan = planSupersededRemovals(
      input({
        uploadObjects: [at(orphan, established), at(staged, established)],
        knownUploadKeys: new Set([staged]),
      }),
    );

    expect(plan.uploadKeys).toEqual([orphan]);
  });

  it("never acts on a key whose shape no rule reads", () => {
    const plan = planSupersededRemovals(
      input({
        coverObjects: [at("covers/only-two-parts", established)],
        uploadObjects: [at("epub-uploads/upload-1/extra", established)],
        liveNovels: new Map([["novel-1", null]]),
      }),
    );

    expect(plan).toMatchObject({ coverSets: [], exportKeys: [], uploadKeys: [], tooFresh: 0 });
  });
});

describe("reapSupersededAssets", () => {
  /**
   * A clock far enough ahead that every object this test writes is older than the grace period. The
   * alternative — backdating files under the adapter's own root — would test the clock rather than
   * the rule the clock feeds.
   */
  const afterTheGracePeriod = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  it("removes a superseded cover segment, keeps the live one, and leaves a deleted novel alone", async () => {
    await reset();
    const live = coverPrefix("novel-1", "new");
    const superseded = coverPrefix("novel-1", "old");
    const gone = coverPrefix("novel-gone", "segment");
    rows.novels.set("novel-1", novelRow("novel-1", live));

    await seed(coverVariantKey(live, 640));
    await seed(coverVariantKey(superseded, 640));
    await seed(coverVariantKey(superseded, 320));
    await seed(coverVariantKey(gone, 640));

    const result = await reapSupersededAssets(afterTheGracePeriod);

    expect(result.deletedSets).toEqual([superseded]);
    expect(result.deletedObjects).toBe(2);
    expect(result.failures).toEqual([]);
    await expect(exists(coverVariantKey(superseded, 640))).resolves.toBe(false);
    await expect(exists(coverVariantKey(superseded, 320))).resolves.toBe(false);
    await expect(exists(coverVariantKey(live, 640))).resolves.toBe(true);
    // A novel with no row is the orphan prune's to remove, not this sweep's.
    await expect(exists(coverVariantKey(gone, 640))).resolves.toBe(true);
  });

  it("removes the export revisions the content moved past and keeps the current one", async () => {
    await reset();
    const novel = novelRow("novel-1");
    const stats = chapterStats();
    rows.novels.set("novel-1", novel);
    rows.chapters.set("novel-1", stats);

    // The key the route would compute for this novel right now, built by the same function it uses.
    const current = exportCacheKey({ id: "novel-1", ...novel }, stats, "epub");
    const superseded = exportObjectKey("novel-1", "older4", "epub");
    await seed(current, "private");
    await seed(superseded, "private");

    const result = await reapSupersededAssets(afterTheGracePeriod);

    expect(result.deletedKeys).toEqual([superseded]);
    await expect(exists(superseded, "private")).resolves.toBe(false);
    await expect(exists(current, "private")).resolves.toBe(true);
  });

  it("removes a staged archive no row names and keeps one a row names", async () => {
    await reset();
    const orphan = epubUploadKey("upload-orphan");
    const staged = epubUploadKey("upload-staged");
    rows.uploads.add(staged);

    await seed(orphan, "private");
    await seed(staged, "private");

    const result = await reapSupersededAssets(afterTheGracePeriod);

    expect(result.deletedKeys).toEqual([orphan]);
    await expect(exists(orphan, "private")).resolves.toBe(false);
    await expect(exists(staged, "private")).resolves.toBe(true);
  });

  it("leaves everything alone when the objects are younger than the grace period", async () => {
    await reset();
    const superseded = coverPrefix("novel-1", "old");
    const orphan = epubUploadKey("upload-orphan");
    rows.novels.set("novel-1", novelRow("novel-1", coverPrefix("novel-1", "new")));

    await seed(coverVariantKey(superseded, 640));
    await seed(orphan, "private");

    // The real clock: the objects were written moments ago, which is what an in-flight write looks
    // like to the daily run.
    const result = await reapSupersededAssets();

    expect(result.deletedSets).toEqual([]);
    expect(result.deletedKeys).toEqual([]);
    expect(result.tooFresh).toBe(2);
    await expect(exists(coverVariantKey(superseded, 640))).resolves.toBe(true);
    await expect(exists(orphan, "private")).resolves.toBe(true);
  });

  it("reports a clean pass when nothing a surviving row names has been superseded", async () => {
    await reset();

    const result = await reapSupersededAssets(afterTheGracePeriod);

    expect(result).toEqual({
      deletedSets: [],
      deletedKeys: [],
      deletedObjects: 0,
      tooFresh: 0,
      failures: [],
    });
  });
});
