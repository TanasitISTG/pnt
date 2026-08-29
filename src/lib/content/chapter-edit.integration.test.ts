import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import type {
  reorderChaptersForUser as ReorderChaptersForUser,
  updateChapterForUser as UpdateChapterForUser,
} from "./chapter-edit.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let updateChapterForUser: typeof UpdateChapterForUser;
let reorderChaptersForUser: typeof ReorderChaptersForUser;
const skipEagerDispatch = async () => {};

type ChapterFixture = {
  ownerUserId: string;
  otherUserId: string;
  novelId: string;
  chapterIds: string[];
  runningJobId: string;
};

type ChapterSnapshot = {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
  rawContent: string;
  translatedContent: string | null;
  status: string;
  summary: string | null;
  sourceRevision: number;
  activeJobId: string | null;
  translatedAt: string | null;
  editedAt: string | null;
};

async function seedChapterFixture(withRunningJob = false): Promise<ChapterFixture> {
  const ownerUserId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const chapterIds = [1, 2, 3].map(() => `chapter-${randomUUID()}`);
  const runningJobId = `job-${randomUUID()}`;

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ownerUserId}, 'Chapter Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other Owner', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "story_summary", "created_at", "updated_at"
    ) VALUES
      (${novelId}, ${ownerUserId}, 'Chapter Edit Novel', 'en', 'th', 'Rolling summary', now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "translated_title", "raw_content", "translated_content",
      "status", "summary", "raw_char_count", "source_revision", "translation_generation",
      "active_translation_job_id", "translated_at", "edited_at", "created_at", "updated_at"
    ) VALUES
      (
        ${chapterIds[0]}, ${novelId}, 1, 'Source one', 'Translated one', 'Raw one', 'Translation one',
        'translated', 'Summary one', 8, 4, 2, NULL, now(), now(), now(), now()
      ),
      (
        ${chapterIds[1]}, ${novelId}, 1.5, 'Source two', NULL, 'Raw two', NULL,
        'raw', NULL, 8, 7, 0, NULL, NULL, NULL, now(), now()
      ),
      (
        ${chapterIds[2]}, ${novelId}, 3, 'Source three', 'Translated three', 'Raw three', 'Translation three',
        'translated', 'Summary three', 10, 9, 1, NULL, now(), now(), now(), now()
      )
  `;

  if (withRunningJob) {
    await sql`
      INSERT INTO "translation_jobs" (
        "id", "chapter_id", "status", "source_revision", "generation", "total_chunks", "done_chunks",
        "created_at", "updated_at"
      ) VALUES (${runningJobId}, ${chapterIds[0]}, 'running', 4, 2, 1, 0, now(), now())
    `;
    await sql`
      UPDATE "chapters"
      SET "active_translation_job_id" = ${runningJobId}, "status" = 'translating'
      WHERE "id" = ${chapterIds[0]}
    `;
  }

  return { ownerUserId, otherUserId, novelId, chapterIds, runningJobId };
}

async function readChapters(novelId: string): Promise<ChapterSnapshot[]> {
  const rows = await sql<ChapterSnapshot[]>`
    SELECT
      "id",
      "number",
      "title",
      "translated_title" AS "translatedTitle",
      "raw_content" AS "rawContent",
      "translated_content" AS "translatedContent",
      "status",
      "summary",
      "source_revision" AS "sourceRevision",
      "active_translation_job_id" AS "activeJobId",
      "translated_at"::text AS "translatedAt",
      "edited_at"::text AS "editedAt"
    FROM "chapters"
    WHERE "novel_id" = ${novelId}
    ORDER BY "number"
  `;
  return rows.map((chapter) => ({
    ...chapter,
    sourceRevision: Number(chapter.sourceRevision),
  }));
}

async function deleteFixture(fixture: ChapterFixture) {
  await sql`
    DELETE FROM "translation_outbox"
    WHERE "payload_json"::jsonb ->> 'jobId' = ${fixture.runningJobId}
  `;
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerUserId}, ${fixture.otherUserId})`;
}

integrationDescribe("chapter edit PostgreSQL invariants", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    // Load server-only database code after the test database override is set.
    ({ updateChapterForUser, reorderChaptersForUser } = await import("./chapter-edit.service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("enforces ownership and leaves no-op edits untouched", async () => {
    const fixture = await seedChapterFixture();
    try {
      const before = await readChapters(fixture.novelId);
      const beforeUpdatedAt = await sql<{ updatedAt: string }[]>`
        SELECT "updated_at"::text AS "updatedAt"
        FROM "chapters" WHERE "id" = ${fixture.chapterIds[0]}
      `;

      await expect(
        updateChapterForUser(
          fixture.otherUserId,
          { chapterId: fixture.chapterIds[0], translatedTitle: "Not allowed" },
          skipEagerDispatch,
        ),
      ).rejects.toThrow("Chapter not found or unauthorized");

      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          {
            chapterId: fixture.chapterIds[0],
            title: "Source one",
            rawContent: "Raw one",
            translatedTitle: "Translated one",
            translatedContent: "Translation one",
          },
          skipEagerDispatch,
        ),
      ).resolves.toEqual({ id: fixture.chapterIds[0] });

      expect(await readChapters(fixture.novelId)).toEqual(before);
      const [afterUpdatedAt] = await sql<{ updatedAt: string }[]>`
        SELECT "updated_at"::text AS "updatedAt"
        FROM "chapters" WHERE "id" = ${fixture.chapterIds[0]}
      `;
      expect(afterUpdatedAt.updatedAt).toBe(beforeUpdatedAt[0].updatedAt);
    } finally {
      await deleteFixture(fixture);
    }
  });
  it("rejects whitespace-only content without changing the chapter", async () => {
    const fixture = await seedChapterFixture();
    try {
      const before = await readChapters(fixture.novelId);
      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          {
            chapterId: fixture.chapterIds[0],
            title: "   ",
            sourceChangePolicy: "keep",
          },
          skipEagerDispatch,
        ),
      ).rejects.toThrow("Source title is required");
      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          {
            chapterId: fixture.chapterIds[0],
            rawContent: "\n\t",
            sourceChangePolicy: "keep",
          },
          skipEagerDispatch,
        ),
      ).rejects.toThrow("Source content is required");
      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          {
            chapterId: fixture.chapterIds[0],
            translatedContent: "   ",
          },
          skipEagerDispatch,
        ),
      ).rejects.toThrow("Translation cannot be empty");
      expect(await readChapters(fixture.novelId)).toEqual(before);
    } finally {
      await deleteFixture(fixture);
    }
  });

  it("preserves derived summaries for translated-title-only edits", async () => {
    const fixture = await seedChapterFixture();
    try {
      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          { chapterId: fixture.chapterIds[0], translatedTitle: "Edited one" },
          skipEagerDispatch,
        ),
      ).resolves.toEqual({ id: fixture.chapterIds[0] });

      const [chapter] = await readChapters(fixture.novelId);
      const [novel] = await sql<{ storySummary: string | null }[]>`
        SELECT "story_summary" AS "storySummary" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(chapter).toMatchObject({
        translatedTitle: "Edited one",
        translatedContent: "Translation one",
        status: "translated",
        summary: "Summary one",
        sourceRevision: 4,
      });
      expect(novel.storySummary).toBe("Rolling summary");
    } finally {
      await deleteFixture(fixture);
    }
  });

  it("requires a source policy and supports keep and clear transitions", async () => {
    const fixture = await seedChapterFixture();
    try {
      const before = await readChapters(fixture.novelId);
      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          { chapterId: fixture.chapterIds[0], rawContent: "Changed raw" },
          skipEagerDispatch,
        ),
      ).rejects.toThrow("Choose whether to keep or clear the translation");
      expect(await readChapters(fixture.novelId)).toEqual(before);

      await updateChapterForUser(
        fixture.ownerUserId,
        {
          chapterId: fixture.chapterIds[0],
          title: "Changed source",
          rawContent: "Changed raw",
          sourceChangePolicy: "keep",
        },
        skipEagerDispatch,
      );
      const [kept] = await readChapters(fixture.novelId);
      expect(kept).toMatchObject({
        title: "Changed source",
        rawContent: "Changed raw",
        translatedTitle: "Translated one",
        translatedContent: "Translation one",
        status: "translated",
        summary: null,
        sourceRevision: 5,
      });
      const [keptNovel] = await sql<{ storySummary: string | null }[]>`
        SELECT "story_summary" AS "storySummary" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(keptNovel.storySummary).toBeNull();

      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          {
            chapterId: fixture.chapterIds[0],
            rawContent: "Cleared raw",
            translatedContent: null,
            sourceChangePolicy: "clear",
          },
          skipEagerDispatch,
        ),
      ).resolves.toEqual({ id: fixture.chapterIds[0] });
      const [cleared] = await readChapters(fixture.novelId);
      expect(cleared).toMatchObject({
        rawContent: "Cleared raw",
        translatedTitle: null,
        translatedContent: null,
        status: "raw",
        summary: null,
        sourceRevision: 6,
        translatedAt: null,
        editedAt: null,
      });

      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          { chapterId: fixture.chapterIds[0], translatedContent: null },
          skipEagerDispatch,
        ),
      ).rejects.toThrow("Translated content can only be cleared");
    } finally {
      await deleteFixture(fixture);
    }
  });

  it("cancels active work and records its exact generation", async () => {
    const fixture = await seedChapterFixture(true);
    const dispatched: string[] = [];
    try {
      await expect(
        updateChapterForUser(
          fixture.ownerUserId,
          {
            chapterId: fixture.chapterIds[0],
            rawContent: "Changed while running",
            sourceChangePolicy: "clear",
          },
          async (outboxId) => {
            dispatched.push(outboxId);
          },
        ),
      ).resolves.toEqual({ id: fixture.chapterIds[0] });

      expect(dispatched).toHaveLength(1);
      const [job] = await sql<{ status: string }[]>`
        SELECT "status" FROM "translation_jobs" WHERE "id" = ${fixture.runningJobId}
      `;
      const [chapter] = await readChapters(fixture.novelId);
      const [event] = await sql<
        Array<{ status: string; payload: { jobId: string; generation: number } }>
      >`
        SELECT "status", "payload_json"::jsonb AS "payload"
        FROM "translation_outbox"
        WHERE "id" = ${dispatched[0]}
      `;
      expect(job.status).toBe("cancelled");
      expect(chapter.activeJobId).toBeNull();
      expect(event).toEqual({
        status: "pending",
        payload: { jobId: fixture.runningJobId, generation: 2 },
      });
    } finally {
      await deleteFixture(fixture);
    }
  });

  it("reassigns 1, 1.5, and 3 slots without losing translations", async () => {
    const fixture = await seedChapterFixture();
    try {
      await expect(
        reorderChaptersForUser(fixture.ownerUserId, {
          novelId: fixture.novelId,
          chapterIds: [fixture.chapterIds[2], fixture.chapterIds[0], fixture.chapterIds[1]],
        }),
      ).resolves.toEqual({ reordered: 3 });

      const after = await readChapters(fixture.novelId);
      expect(after.map((chapter) => [chapter.id, chapter.number])).toEqual([
        [fixture.chapterIds[2], "1.00"],
        [fixture.chapterIds[0], "1.50"],
        [fixture.chapterIds[1], "3.00"],
      ]);
      expect(
        Object.fromEntries(after.map((chapter) => [chapter.id, chapter.sourceRevision])),
      ).toEqual({
        [fixture.chapterIds[0]]: 5,
        [fixture.chapterIds[1]]: 8,
        [fixture.chapterIds[2]]: 10,
      });
      expect(after.find((chapter) => chapter.id === fixture.chapterIds[0])).toMatchObject({
        translatedTitle: "Translated one",
        translatedContent: "Translation one",
        summary: "Summary one",
      });
      expect(after.find((chapter) => chapter.id === fixture.chapterIds[2])).toMatchObject({
        translatedTitle: "Translated three",
        translatedContent: "Translation three",
        summary: "Summary three",
      });
      const [novel] = await sql<{ storySummary: string | null }[]>`
        SELECT "story_summary" AS "storySummary" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(novel.storySummary).toBeNull();

      const [beforeNoOpNovel] = await sql<{ updatedAt: string }[]>`
        SELECT "updated_at"::text AS "updatedAt" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      await expect(
        reorderChaptersForUser(fixture.ownerUserId, {
          novelId: fixture.novelId,
          chapterIds: [fixture.chapterIds[2], fixture.chapterIds[0], fixture.chapterIds[1]],
        }),
      ).resolves.toEqual({ reordered: 0 });
      const [afterNoOpNovel] = await sql<{ updatedAt: string }[]>`
        SELECT "updated_at"::text AS "updatedAt" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(afterNoOpNovel.updatedAt).toBe(beforeNoOpNovel.updatedAt);
    } finally {
      await deleteFixture(fixture);
    }
  });

  it("rejects stale permutations and active-job reordering atomically", async () => {
    const staleFixture = await seedChapterFixture();
    try {
      const before = await readChapters(staleFixture.novelId);
      await expect(
        reorderChaptersForUser(staleFixture.ownerUserId, {
          novelId: staleFixture.novelId,
          chapterIds: [staleFixture.chapterIds[0], staleFixture.chapterIds[1]],
        }),
      ).rejects.toThrow("Chapter order is stale");
      expect(await readChapters(staleFixture.novelId)).toEqual(before);
      await expect(
        reorderChaptersForUser(staleFixture.ownerUserId, {
          novelId: staleFixture.novelId,
          chapterIds: [
            staleFixture.chapterIds[0],
            staleFixture.chapterIds[0],
            staleFixture.chapterIds[2],
          ],
        }),
      ).rejects.toThrow("Chapter order is stale");
      expect(await readChapters(staleFixture.novelId)).toEqual(before);
    } finally {
      await deleteFixture(staleFixture);
    }

    const activeFixture = await seedChapterFixture(true);
    try {
      const before = await readChapters(activeFixture.novelId);
      await expect(
        reorderChaptersForUser(activeFixture.ownerUserId, {
          novelId: activeFixture.novelId,
          chapterIds: [
            activeFixture.chapterIds[2],
            activeFixture.chapterIds[0],
            activeFixture.chapterIds[1],
          ],
        }),
      ).rejects.toThrow("Chapter order cannot change while translation is active");
      expect(await readChapters(activeFixture.novelId)).toEqual(before);
    } finally {
      await deleteFixture(activeFixture);
    }
  }, 30_000);
});
