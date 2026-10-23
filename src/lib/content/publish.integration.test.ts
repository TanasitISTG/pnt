import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";
import type * as AdminDetail from "@/lib/content/novel/admin-novel-detail.service";
import type * as Publish from "@/lib/content/publish/publish.service";
import type * as Readiness from "@/lib/content/publish/readiness.service";
import { encodeMessage } from "@/lib/i18n/message-code";
import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

let sql: Sql;
let getAdminNovelDetailCoreForUser: typeof AdminDetail.getAdminNovelDetailCoreForUser;
let setChapterPublishedForUser: typeof Publish.setChapterPublishedForUser;
let setAllChaptersPublishedForUser: typeof Publish.setAllChaptersPublishedForUser;
let withholdIncompleteScheduledPublications: typeof Readiness.withholdIncompleteScheduledPublications;

const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

type PublicationFixture = {
  ownerUserId: string;
  otherUserId: string;
  novelId: string;
  chapterIds: string[];
};

async function seedFixture(): Promise<PublicationFixture> {
  const ownerUserId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const chapterIds = Array.from({ length: 7 }, () => `chapter-${randomUUID()}`);
  const chapters = [
    { status: "raw", translatedContent: null, publishedAt: PAST },
    { status: "queued", translatedContent: null, publishedAt: PAST },
    { status: "translating", translatedContent: null, publishedAt: PAST },
    { status: "error", translatedContent: "Old translation", publishedAt: PAST },
    { status: "error", translatedContent: null, publishedAt: PAST },
    { status: "translated", translatedContent: "Scheduled translation", publishedAt: FUTURE },
    { status: "translated", translatedContent: "Ready translation", publishedAt: PAST },
  ];

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ownerUserId}, 'Publication Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other Owner', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at"
    ) VALUES (${novelId}, ${ownerUserId}, 'Publication Fixture', 'en', 'th', ${PAST}, now(), now())
  `;

  for (const [index, chapter] of chapters.entries()) {
    await sql`
      INSERT INTO "chapters" (
        "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
        "raw_char_count", "published_at", "created_at", "updated_at"
      ) VALUES (
        ${chapterIds[index]}, ${novelId}, ${index + 1}, ${`Chapter ${index + 1}`}, 'Raw source',
        ${chapter.translatedContent}, ${chapter.status}, 10, ${chapter.publishedAt}, now(), now()
      )
    `;
  }

  return { ownerUserId, otherUserId, novelId, chapterIds };
}

async function guestVisibleChapterIds(novelId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT c."id"
    FROM "chapters" c
    INNER JOIN "novels" n ON n."id" = c."novel_id"
    WHERE n."id" = ${novelId}
      AND n."published_at" <= now()
      AND c."published_at" <= now()
      AND c."status" = 'translated'
    ORDER BY c."number"
  `;
  return rows.map((row) => row.id);
}

async function cleanupFixture(fixture: PublicationFixture): Promise<void> {
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerUserId}, ${fixture.otherUserId})`;
}

interface PreflightFixture {
  ownerUserId: string;
  novelId: string;
  chapterId: string;
}

/** One translated chapter, so a run can be attached to it exactly as the worker would. */
async function seedPreflightChapter(input: {
  rawContent: string;
  translatedContent: string;
  status?: string;
  publishedAt?: string | null;
}): Promise<PreflightFixture> {
  const ownerUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const chapterId = `chapter-${randomUUID()}`;

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES (${ownerUserId}, 'Preflight Owner', ${`${ownerUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at"
    ) VALUES (${novelId}, ${ownerUserId}, 'Preflight Fixture', 'en', 'th', ${PAST}, now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
      "raw_char_count", "translation_generation", "published_at", "created_at", "updated_at"
    ) VALUES (
      ${chapterId}, ${novelId}, 1, 'Chapter 1', ${input.rawContent}, ${input.translatedContent},
      ${input.status ?? "translated"}, ${input.rawContent.length}, 1, ${input.publishedAt ?? null},
      now(), now()
    )
  `;

  return { ownerUserId, novelId, chapterId };
}

/** The run rows `completeJob` leaves behind: one job, its chunks, and the version that names it. */
async function seedRun(
  chapterId: string,
  input: {
    status?: string;
    doneChunks?: number;
    chunks: { index: number; translation: string | null; error: string | null }[];
    recordVersion?: boolean;
  },
): Promise<string> {
  const jobId = `job-${randomUUID()}`;
  const totalChunks = input.chunks.length;
  const doneChunks = input.doneChunks ?? totalChunks;

  await sql`
    INSERT INTO "translation_jobs" (
      "id", "chapter_id", "status", "source_revision", "generation", "total_chunks", "done_chunks",
      "created_at", "updated_at"
    ) VALUES (${jobId}, ${chapterId}, ${input.status ?? "done"}, 1, 1, ${totalChunks}, ${doneChunks}, now(), now())
  `;
  for (const chunk of input.chunks) {
    await sql`
      INSERT INTO "translation_job_chunks" (
        "job_id", "chunk_index", "source_text", "text_length", "translation", "error"
      ) VALUES (${jobId}, ${chunk.index}, 'Source chunk', 12, ${chunk.translation}, ${chunk.error})
    `;
  }
  if (input.recordVersion !== false) {
    await sql`
      INSERT INTO "chapter_translation_versions" (
        "id", "chapter_id", "generation", "source_revision", "origin", "job_id", "content",
        "char_count", "created_at"
      ) VALUES (${`version-${randomUUID()}`}, ${chapterId}, 1, 1, 'translation', ${jobId}, 'Body', 4, now())
    `;
  }

  return jobId;
}

async function publishedAtOf(chapterId: string): Promise<Date | null> {
  const [row] = await sql<{ publishedAt: Date | null }[]>`
    SELECT "published_at" AS "publishedAt" FROM "chapters" WHERE "id" = ${chapterId}
  `;
  return row?.publishedAt ?? null;
}

async function notificationCount(chapterId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    SELECT count(*) AS "count" FROM "notifications" WHERE "chapter_id" = ${chapterId}
  `;
  return Number(row?.count ?? 0);
}

describeIntegration("translation-aware publication PostgreSQL invariants", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url, { connections: 10 }));
    ({ getAdminNovelDetailCoreForUser } =
      await import("@/lib/content/novel/admin-novel-detail.service"));
    ({ setChapterPublishedForUser, setAllChaptersPublishedForUser } =
      await import("@/lib/content/publish/publish.service"));
    ({ withholdIncompleteScheduledPublications } =
      await import("@/lib/content/publish/readiness.service"));
  });

  afterAll(closeIntegrationDatabase);

  it("rejects foreign and deleted chapter publication without changing other rows", async () => {
    const fixture = await seedFixture();
    try {
      await expect(
        setChapterPublishedForUser(fixture.otherUserId, {
          chapterId: fixture.chapterIds[6],
          publishedAt: null,
        }),
      ).rejects.toThrow(encodeMessage("errors.chapterNotFoundOrUnauthorized"));
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([fixture.chapterIds[6]]);
      await sql`DELETE FROM "chapters" WHERE "id" = ${fixture.chapterIds[6]}`;
      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterIds[6],
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow(encodeMessage("errors.chapterNotFoundOrUnauthorized"));
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps guest visibility and admin access aligned across every chapter state", async () => {
    const fixture = await seedFixture();
    try {
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([fixture.chapterIds[6]]);

      const adminCore = await getAdminNovelDetailCoreForUser(fixture.ownerUserId, fixture.novelId);
      expect(adminCore?.chapters.map((chapter) => chapter.id)).toEqual(fixture.chapterIds);
      await expect(
        getAdminNovelDetailCoreForUser(fixture.otherUserId, fixture.novelId),
      ).resolves.toBeNull();

      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterIds[0]!,
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow(encodeMessage("errors.chapterNotTranslatedForPublish"));

      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterIds[0]!,
          publishedAt: null,
        }),
      ).resolves.toEqual({ id: fixture.chapterIds[0] });

      await expect(
        setAllChaptersPublishedForUser(fixture.otherUserId, fixture.novelId, new Date(PAST)),
      ).rejects.toThrow(encodeMessage("errors.novelNotFoundOrUnauthorized"));

      await expect(
        setAllChaptersPublishedForUser(fixture.ownerUserId, fixture.novelId, new Date(PAST)),
      ).resolves.toEqual({ id: fixture.novelId, published: 2, skipped: 5, blocked: [] });
      await expect(
        setAllChaptersPublishedForUser(fixture.ownerUserId, fixture.novelId, null),
      ).resolves.toEqual({ id: fixture.novelId, unpublished: 7 });
      expect(await guestVisibleChapterIds(fixture.novelId)).toEqual([]);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30_000);

  it("refuses a chapter whose run left an unusable chunk, before writing anything", async () => {
    const fixture = await seedPreflightChapter({
      rawContent: "one\n\ntwo",
      translatedContent: "หนึ่ง\n\nสอง",
    });
    await seedRun(fixture.chapterId, {
      chunks: [
        { index: 0, translation: null, error: "provider timeout" },
        { index: 1, translation: "สอง", error: null },
      ],
    });
    try {
      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterId,
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow(encodeMessage("errors.chapterPublishBlockedChunkFailed", { count: 1 }));

      // Scheduling is the same entry, one timestamp later: a future publication time is
      // gated identically, because nothing writes when that time arrives.
      await expect(
        setChapterPublishedForUser(fixture.ownerUserId, {
          chapterId: fixture.chapterId,
          publishedAt: new Date(FUTURE),
        }),
      ).rejects.toThrow(encodeMessage("errors.chapterPublishBlockedChunkFailed", { count: 1 }));

      // The gate sits before every side effect: no publication, and no fan-out for a chapter
      // that never went live.
      expect(await publishedAtOf(fixture.chapterId)).toBeNull();
      expect(await notificationCount(fixture.chapterId)).toBe(0);
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${fixture.ownerUserId}`;
    }
  }, 30_000);

  it("refuses a translation that lost a paragraph, and allows one that kept them", async () => {
    const short = await seedPreflightChapter({
      rawContent: "one\n\ntwo\n\nthree",
      translatedContent: "หนึ่ง\n\nสอง",
    });
    try {
      await expect(
        setChapterPublishedForUser(short.ownerUserId, {
          chapterId: short.chapterId,
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow(
        encodeMessage("errors.chapterPublishBlockedMissingParagraphs", { count: 1 }),
      );
      expect(await publishedAtOf(short.chapterId)).toBeNull();
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${short.ownerUserId}`;
    }

    // A hand-written translation with the same paragraph count publishes: the gate judges
    // truncation, not provenance.
    const complete = await seedPreflightChapter({
      rawContent: "one\n\ntwo",
      translatedContent: "หนึ่ง\n\nสอง",
    });
    try {
      await expect(
        setChapterPublishedForUser(complete.ownerUserId, {
          chapterId: complete.chapterId,
          publishedAt: new Date(PAST),
        }),
      ).resolves.toEqual({ id: complete.chapterId });
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${complete.ownerUserId}`;
    }
  }, 30_000);

  it("refuses a chapter a run still owns, and one whose run never finished", async () => {
    const inFlight = await seedPreflightChapter({
      rawContent: "one",
      translatedContent: "หนึ่ง",
    });
    const jobId = await seedRun(inFlight.chapterId, {
      status: "running",
      doneChunks: 0,
      chunks: [{ index: 0, translation: null, error: null }],
    });
    await sql`
      UPDATE "chapters" SET "active_translation_job_id" = ${jobId} WHERE "id" = ${inFlight.chapterId}
    `;
    try {
      await expect(
        setChapterPublishedForUser(inFlight.ownerUserId, {
          chapterId: inFlight.chapterId,
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow(encodeMessage("errors.chapterPublishBlockedInFlight"));
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${inFlight.ownerUserId}`;
    }

    const abandoned = await seedPreflightChapter({
      rawContent: "one",
      translatedContent: "หนึ่ง",
    });
    await seedRun(abandoned.chapterId, {
      status: "error",
      doneChunks: 0,
      chunks: [{ index: 0, translation: "หนึ่ง", error: null }],
    });
    try {
      await expect(
        setChapterPublishedForUser(abandoned.ownerUserId, {
          chapterId: abandoned.chapterId,
          publishedAt: new Date(PAST),
        }),
      ).rejects.toThrow(encodeMessage("errors.chapterPublishBlockedIncomplete"));
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${abandoned.ownerUserId}`;
    }
  }, 30_000);

  it("publishes what it can in bulk and names what it held back", async () => {
    const fixture = await seedPreflightChapter({
      rawContent: "one",
      translatedContent: "หนึ่ง",
    });
    const blockedId = `chapter-${randomUUID()}`;
    const rawId = `chapter-${randomUUID()}`;
    await sql`
      INSERT INTO "chapters" (
        "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
        "raw_char_count", "published_at", "created_at", "updated_at"
      ) VALUES
        (${blockedId}, ${fixture.novelId}, 2, 'Chapter 2', ${"a\n\nb\n\nc"}, 'ก', 'translated', 5, null, now(), now()),
        (${rawId}, ${fixture.novelId}, 3, 'Chapter 3', 'raw', null, 'raw', 3, null, now(), now())
    `;
    try {
      const result = await setAllChaptersPublishedForUser(
        fixture.ownerUserId,
        fixture.novelId,
        new Date(PAST),
      );
      expect("unpublished" in result).toBe(false);
      if ("unpublished" in result) throw new Error("expected a publish result");

      expect(result.published).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.blocked).toHaveLength(1);
      expect(result.blocked[0]?.id).toBe(blockedId);
      expect(Number(result.blocked[0]?.number)).toBe(2);
      expect(result.blocked[0]?.blockers).toEqual([
        { reason: "missing-paragraphs", missingParagraphs: 2 },
      ]);
      expect(await publishedAtOf(blockedId)).toBeNull();
      expect(await publishedAtOf(rawId)).toBeNull();
      expect(await publishedAtOf(fixture.chapterId)).not.toBeNull();
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${fixture.ownerUserId}`;
    }
  }, 30_000);

  it("leaves an already-live chapter live even when its text no longer passes", async () => {
    const fixture = await seedPreflightChapter({
      rawContent: "one\n\ntwo\n\nthree",
      translatedContent: "หนึ่ง",
      publishedAt: PAST,
    });
    try {
      const result = await setAllChaptersPublishedForUser(
        fixture.ownerUserId,
        fixture.novelId,
        new Date(PAST),
      );
      expect("unpublished" in result).toBe(false);
      if ("unpublished" in result) throw new Error("expected a publish result");
      expect(result.blocked).toEqual([]);
      expect(result.published).toBe(1);
      expect(await publishedAtOf(fixture.chapterId)).not.toBeNull();
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${fixture.ownerUserId}`;
    }
  }, 30_000);

  it("withholds only the scheduled chapter that no longer passes", async () => {
    const fixture = await seedPreflightChapter({
      rawContent: "one\n\ntwo\n\nthree",
      translatedContent: "หนึ่ง",
    });
    const soundId = `chapter-${randomUUID()}`;
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    await sql`
      UPDATE "chapters" SET "published_at" = ${soon} WHERE "id" = ${fixture.chapterId}
    `;
    await sql`
      INSERT INTO "chapters" (
        "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
        "raw_char_count", "published_at", "created_at", "updated_at"
      ) VALUES (
        ${soundId}, ${fixture.novelId}, 2, 'Chapter 2', ${"a\n\nb"}, ${"ก\n\nข"}, 'translated', 3,
        ${soon}, now(), now()
      )
    `;
    try {
      const result = await withholdIncompleteScheduledPublications();
      expect(result.withheld).toBeGreaterThanOrEqual(1);
      expect(await publishedAtOf(fixture.chapterId)).toBeNull();
      expect(await publishedAtOf(soundId)).not.toBeNull();
    } finally {
      await sql`DELETE FROM "user" WHERE "id" = ${fixture.ownerUserId}`;
    }
  }, 30_000);
});
