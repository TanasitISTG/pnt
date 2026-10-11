import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { chapters, glossaryTerms, novels } from "@/lib/db/schema";
import { SafeServerError } from "@/lib/server-fn-error";
import { exportBackupForUser, importBackupForUser, streamBackupForUser } from "./backup.service";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

// In-memory object storage: these tests defend backup orchestration, not bucket
// behaviour, so no network or filesystem is involved.
const storageMock = vi.hoisted(() => {
  interface Entry {
    bytes: Uint8Array;
    contentType: string | null;
  }
  const createBucket = () => {
    const objects = new Map<string, Entry>();
    return {
      objects,
      async put(key: string, bytes: Uint8Array, options: { contentType: string }) {
        objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.contentType });
      },
      async get(key: string) {
        const entry = objects.get(key);
        return entry
          ? { bytes: new Uint8Array(entry.bytes), contentType: entry.contentType }
          : null;
      },
      async head(key: string) {
        const entry = objects.get(key);
        return entry ? { size: entry.bytes.length, contentType: entry.contentType } : null;
      },
      async delete(key: string) {
        objects.delete(key);
      },
      async deletePrefix(prefix: string) {
        for (const key of objects.keys()) {
          if (key.startsWith(prefix)) objects.delete(key);
        }
      },
      async presignPut() {
        return "https://storage.test/upload";
      },
      publicUrl(key: string) {
        return `https://cdn.test/${key}`;
      },
    };
  };
  const buckets = { public: createBucket(), private: createBucket() };
  return {
    buckets,
    api: {
      getStorage: () => buckets,
      getPublicStorage: () => buckets.public,
      getPrivateStorage: () => buckets.private,
      isLocalStorage: () => false,
      resetStorageCache: () => {},
    },
  };
});

vi.mock("@/lib/storage/index.server", () => storageMock.api);

// Sharp is exercised directly in cover-image.server.test.ts; here the cover bytes
// are a placeholder signature, so variant generation passes them through.
vi.mock("@/lib/content/novel/cover-image.server", () => ({
  resizeCover: async (buffer: Uint8Array) => buffer,
}));

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const exportedAt = "2026-01-01T00:00:00.000Z";
const COVER_KEY = "covers/novel-1/segment";
const COVER_ORIGINAL_KEY = `${COVER_KEY}/original`;

function seedStoredCover(contentType: string | null): void {
  storageMock.buckets.public.objects.set(COVER_ORIGINAL_KEY, {
    bytes: new Uint8Array(PNG_BYTES),
    contentType,
  });
}

function novelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "novel-1",
    userId: "user-1",
    title: "Novel",
    originalTitle: null,
    author: null,
    description: null,
    coverKey: null,
    coverMime: null,
    sourceLang: "zh",
    targetLang: "en",
    customPrompt: null,
    storySummary: null,
    relationshipMapJson: '{"version":1,"characters":[],"relationships":[]}',
    chunkSize: 4000,
    contextTailLength: 500,
    publishedAt: null,
    createdAt: new Date(exportedAt),
    updatedAt: new Date(exportedAt),
    ...overrides,
  };
}

function chapterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "chapter-1",
    novelId: "novel-1",
    number: "1.00",
    title: "Chapter 1",
    translatedTitle: null,
    rawContent: "Raw content",
    translatedContent: null,
    status: "raw",
    summary: null,
    rawCharCount: 11,
    sourceRevision: 0,
    translationGeneration: 0,
    activeTranslationJobId: null,
    publishedAt: null,
    translatedAt: null,
    editedAt: null,
    createdAt: new Date(exportedAt),
    updatedAt: new Date(exportedAt),
    ...overrides,
  };
}

function backupPayload(novelOverrides: Record<string, unknown> = {}) {
  return {
    app: "pnt",
    schemaVersion: 1,
    exportedAt,
    novels: [
      {
        id: "novel-1",
        title: "Novel",
        originalTitle: null,
        author: null,
        description: null,
        coverBase64: null,
        coverMime: null,
        sourceLang: "zh",
        targetLang: "en",
        customPrompt: null,
        storySummary: null,
        chunkSize: 4000,
        contextTailLength: 500,
        publishedAt: null,
        createdAt: exportedAt,
        updatedAt: exportedAt,
        chapters: [
          {
            id: "chapter-1",
            number: "1.00",
            title: "Chapter 1",
            translatedTitle: null,
            rawContent: "Raw content",
            translatedContent: null,
            status: "raw",
            summary: null,
            rawCharCount: 11,
            sourceRevision: 0,
            translationGeneration: 0,
            publishedAt: null,
            translatedAt: null,
            editedAt: null,
            createdAt: exportedAt,
            updatedAt: exportedAt,
          },
        ],
        glossaryTerms: [],
        ...novelOverrides,
      },
    ],
  };
}

let selectQueue: unknown[][];
let insertedValues: { table: unknown; rows: unknown }[];

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  insertedValues = [];
  storageMock.buckets.public.objects.clear();
  storageMock.buckets.private.objects.clear();
  vi.mocked(db.select).mockImplementation(() => {
    const rows = selectQueue.shift() ?? [];
    // Both `await query.orderBy(...)` (materialized export) and
    // `query.orderBy(...).limit(n)` (streaming page) must resolve to the rows.
    const settle = () => {
      const result = Promise.resolve(rows);
      return Object.assign(result, { limit: () => result });
    };
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: settle,
      limit: settle,
    };
    return chain as never;
  });
  vi.mocked(db.transaction).mockImplementation((async (
    callback: (tx: unknown) => Promise<unknown>,
  ) => {
    const tx = {
      insert: (table: unknown) => ({
        values: async (rows: unknown) => {
          insertedValues.push({ table, rows });
        },
      }),
    };
    return callback(tx);
  }) as never);
});

describe("backup export", () => {
  it("produces a file its own restore accepts", async () => {
    selectQueue = [[novelRow()], [chapterRow()], []];

    const backup = await exportBackupForUser("user-1");

    expect(backup.novels[0]?.chapters[0]?.number).toBe("1.00");
    expect(backup.novels[0]?.contextTailLength).toBe(500);
    await expect(importBackupForUser("user-1", backup)).resolves.toEqual({
      importedNovelCount: 1,
      novelIds: [expect.any(String)],
    });
  });

  it("streams the same backup the materialized export produces", async () => {
    selectQueue = [[novelRow()], [chapterRow()], []];
    const materialized = await exportBackupForUser("user-1");

    selectQueue = [[novelRow()], [chapterRow()], []];
    let json = "";
    for await (const chunk of streamBackupForUser("user-1")) json += chunk;

    // `exportedAt` is the export timestamp, so pin only its shape.
    expect(JSON.parse(json)).toEqual({ ...materialized, exportedAt: expect.any(String) });
  });

  it("refuses a cover type the app could not serve or restore", async () => {
    seedStoredCover("image/gif");
    selectQueue = [[novelRow({ coverKey: COVER_KEY, coverMime: "image/gif" })], [], []];

    await expect(exportBackupForUser("user-1")).rejects.toThrow(/unsupported cover media type/);
  });

  it("refuses to export cover bytes with no media type", async () => {
    seedStoredCover(null);
    selectQueue = [[novelRow({ coverKey: COVER_KEY, coverMime: null })], [], []];

    await expect(exportBackupForUser("user-1")).rejects.toThrow(/cover image without a media type/);
  });

  it("reads the cover back out of storage so the file stays self-contained", async () => {
    seedStoredCover("image/png");
    selectQueue = [[novelRow({ coverKey: COVER_KEY, coverMime: "image/png" })], [], []];

    const backup = await exportBackupForUser("user-1");

    expect(backup.novels[0]?.coverMime).toBe("image/png");
    expect(backup.novels[0]?.coverBase64).toBe(PNG_BYTES.toString("base64"));
  });
  it.each([
    "{",
    JSON.stringify({ version: 2, characters: [], relationships: [] }),
    JSON.stringify({
      version: 1,
      characters: [],
      relationships: [
        {
          id: "missing-pair",
          speakerId: "missing-a",
          listenerId: "missing-b",
          relationship: "friend",
          speakerStatus: "peer",
          familiarity: "close",
          selfPronoun: null,
          addresseeTerm: null,
          sentenceParticles: null,
          register: null,
          notes: null,
          enabled: true,
          locked: true,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: exportedAt,
        },
      ],
    }),
  ])("refuses an unreadable stored relationship map: %s", async (relationshipMapJson) => {
    selectQueue = [[novelRow({ relationshipMapJson })], [], []];
    await expect(exportBackupForUser("user-1")).rejects.toBeInstanceOf(SafeServerError);
  });
});

describe("backup import", () => {
  it("rejects cover bytes that do not match the declared image type", async () => {
    const backup = backupPayload({
      coverBase64: Buffer.from("not an image").toString("base64"),
      coverMime: "image/png",
    });

    await expect(importBackupForUser("user-1", backup)).rejects.toThrow(/magic bytes/);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a mismatched raw character count", { rawCharCount: 0 }],
    ["blank translated content", { status: "queued", translatedContent: "   " }],
    ["translated status without content", { status: "translated", translatedContent: null }],
    ["raw status with translated content", { status: "raw", translatedContent: "Stale" }],
  ])("rejects %s before opening a transaction", async (_name, chapterOverrides) => {
    const sourceChapter = backupPayload().novels[0]!.chapters[0]!;
    const backup = backupPayload({
      chapters: [{ ...sourceChapter, ...chapterOverrides }],
    });

    await expect(importBackupForUser("user-1", backup)).rejects.toBeInstanceOf(SafeServerError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("normalizes interrupted chapter statuses according to retained content", async () => {
    const sourceChapter = backupPayload().novels[0]!.chapters[0]!;
    const backup = backupPayload({
      chapters: [
        {
          ...sourceChapter,
          id: "queued-with-content",
          number: "1",
          rawContent: "",
          rawCharCount: 0,
          translatedContent: "Retained translation",
          status: "queued",
        },
        {
          ...sourceChapter,
          id: "queued-without-content",
          number: "2",
          translatedContent: null,
          status: "queued",
        },
        {
          ...sourceChapter,
          id: "translating-with-content",
          number: "3",
          translatedContent: "Retained while translating",
          status: "translating",
        },
        {
          ...sourceChapter,
          id: "translating-without-content",
          number: "4",
          translatedContent: null,
          status: "translating",
        },
      ],
    });

    await importBackupForUser("user-1", backup);

    const restoredChapters = insertedValues
      .filter((entry) => entry.table === chapters)
      .flatMap((entry) => (Array.isArray(entry.rows) ? entry.rows : [entry.rows]));
    expect(restoredChapters).toEqual([
      expect.objectContaining({
        status: "translated",
        translatedContent: "Retained translation",
        rawContent: "",
        rawCharCount: 0,
      }),
      expect.objectContaining({
        status: "raw",
        translatedContent: null,
      }),
      expect.objectContaining({
        status: "translated",
        translatedContent: "Retained while translating",
      }),
      expect.objectContaining({
        status: "raw",
        translatedContent: null,
      }),
    ]);
  });

  it("writes a valid cover, chapters and terms", async () => {
    const backup = backupPayload({
      coverBase64: PNG_BYTES.toString("base64"),
      coverMime: "image/png",
      glossaryTerms: [
        {
          id: "term-1",
          source: "许野",
          target: "สวี่เหยี่ย",
          category: "character",
          note: null,
          status: "approved",
          createdAt: exportedAt,
          updatedAt: exportedAt,
        },
      ],
    });

    await expect(importBackupForUser("user-1", backup)).resolves.toEqual({
      importedNovelCount: 1,
      novelIds: [expect.any(String)],
    });

    const savedRows = (table: unknown) =>
      insertedValues
        .filter((entry) => entry.table === table)
        .flatMap((entry) => (Array.isArray(entry.rows) ? entry.rows : [entry.rows]));
    expect(savedRows(novels)).toEqual([
      expect.objectContaining({
        userId: "user-1",
        title: "Novel (imported)",
        coverMime: "image/png",
        publishedAt: null,
        relationshipMapJson: '{"version":1,"characters":[],"relationships":[]}',
      }),
    ]);
    expect(savedRows(chapters)).toEqual([
      expect.objectContaining({ number: "1.00", title: "Chapter 1" }),
    ]);
    expect(savedRows(glossaryTerms)).toEqual([
      expect.objectContaining({ source: "许野", target: "สวี่เหยี่ย" }),
    ]);
  });

  it("reports the offending field instead of a generic failure", async () => {
    const backup = backupPayload({ contextTailLength: -20 });

    await expect(importBackupForUser("user-1", backup)).rejects.toThrow(/contextTailLength/);
  });
  it.each([
    ["originalTitle", 500],
    ["author", 200],
    ["description", 5000],
    ["customPrompt", 10000],
  ] as const)("rejects oversized %s before opening a transaction", async (field, limit) => {
    await expect(
      importBackupForUser("user-1", backupPayload({ [field]: "x".repeat(limit + 1) })),
    ).rejects.toBeInstanceOf(SafeServerError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each([null, { version: 2, characters: [], relationships: [] }])(
    "rejects an explicitly invalid relationship map before opening a transaction",
    async (relationshipMap) => {
      await expect(
        importBackupForUser("user-1", backupPayload({ relationshipMap })),
      ).rejects.toBeInstanceOf(SafeServerError);
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );
});
