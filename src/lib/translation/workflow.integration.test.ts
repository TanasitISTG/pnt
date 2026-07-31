import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let completeChunk: typeof import("./job-store").completeChunk;
let completeJob: typeof import("./job-store").completeJob;
let enqueueTranslationJob: typeof import("./translation.functions").enqueueTranslationJob;
const skipEagerDispatch = async () => {};

async function seedChapter(rawContent = "First paragraph.\n\nSecond paragraph.") {
  const userId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const chapterId = `chapter-${randomUUID()}`;

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES (${userId}, 'Integration User', ${`${userId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "created_at", "updated_at"
    ) VALUES (${novelId}, ${userId}, 'Integration Novel', 'zh', 'en', now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "raw_content", "raw_char_count", "status"
    ) VALUES (${chapterId}, ${novelId}, 1, 'Chapter 1', ${rawContent}, ${rawContent.length}, 'raw')
  `;

  return { userId, novelId, chapterId };
}

async function deleteFixture(userId: string) {
  await sql`DELETE FROM "user" WHERE "id" = ${userId}`;
}

integrationDescribe("translation workflow PostgreSQL invariants", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({ completeChunk, completeJob } = await import("./job-store"));
    ({ enqueueTranslationJob } = await import("./translation.functions"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("enforces one pending or running job per chapter", async () => {
    const fixture = await seedChapter();
    try {
      const insertJob = (id: string) => sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation", "total_chunks"
        ) VALUES (${id}, ${fixture.chapterId}, 'pending', 1, 1, 1)
      `;
      const results = await Promise.allSettled([
        insertJob(`job-${randomUUID()}`),
        insertJob(`job-${randomUUID()}`),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("serializes concurrent production enqueues and leaves one owner", async () => {
    const fixture = await seedChapter();
    try {
      const provider = { model: "integration-model" } as never;
      const results = await Promise.all([
        enqueueTranslationJob(fixture.userId, fixture.chapterId, provider, skipEagerDispatch),
        enqueueTranslationJob(fixture.userId, fixture.chapterId, provider, skipEagerDispatch),
      ]);

      const jobs = await sql<{ id: string; status: string; generation: number }[]>`
        SELECT "id", "status", "generation"
        FROM "translation_jobs" WHERE "chapter_id" = ${fixture.chapterId}
      `;
      const [chapter] = await sql<{ activeJobId: string | null; generation: number }[]>`
        SELECT "active_translation_job_id" AS "activeJobId", "translation_generation" AS "generation"
        FROM "chapters" WHERE "id" = ${fixture.chapterId}
      `;
      const [cancelEvent] = await sql<{ payload: { jobId: string; generation: number } }[]>`
        SELECT "payload_json"::jsonb AS "payload"
        FROM "translation_outbox"
        WHERE "event_name" = 'translation/job.cancelled'
      `;

      expect(results).toHaveLength(2);
      const pendingJob = jobs.find((job) => job.status === "pending");
      const cancelledJob = jobs.find((job) => job.status === "cancelled");
      expect(pendingJob).toBeDefined();
      expect(cancelledJob).toBeDefined();
      expect(chapter.activeJobId).toBe(pendingJob?.id);
      expect(chapter.generation).toBe(2);
      expect(cancelEvent.payload).toEqual({
        jobId: cancelledJob?.id,
        generation: cancelledJob?.generation,
      });
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("rejects stale finalization without any partial side effects", async () => {
    const fixture = await seedChapter();
    const jobId = `job-${randomUUID()}`;
    const termId = `term-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks"
        ) VALUES (${jobId}, ${fixture.chapterId}, 'running', 1, 1, 1, 1)
      `;
      await sql`
        UPDATE "chapters"
        SET "active_translation_job_id" = ${jobId}, "translation_generation" = 1,
            "source_revision" = 2, "status" = 'translating'
        WHERE "id" = ${fixture.chapterId}
      `;

      await expect(
        completeJob({
          jobId,
          generation: 1,
          fullTranslation: "Stale translation",
          storySummary: "Stale summary",
          glossaryRows: [
            {
              id: termId,
              novelId: fixture.novelId,
              source: "stale",
              target: "stale",
              category: "other",
              status: "approved",
            },
          ],
          logsJson: "[]",
          usageJson: "{}",
        }),
      ).resolves.toBe(false);

      const [chapter] = await sql<{ translatedContent: string | null }[]>`
        SELECT "translated_content" AS "translatedContent" FROM "chapters"
        WHERE "id" = ${fixture.chapterId}
      `;
      const [novel] = await sql<{ storySummary: string | null }[]>`
        SELECT "story_summary" AS "storySummary" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      const terms = await sql`SELECT "id" FROM "glossary_terms" WHERE "id" = ${termId}`;

      expect(chapter.translatedContent).toBeNull();
      expect(novel.storySummary).toBeNull();
      expect(terms).toHaveLength(0);
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("rejects cancel-during-finalize without writing artifacts", async () => {
    const fixture = await seedChapter();
    const jobId = `job-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks"
        ) VALUES (${jobId}, ${fixture.chapterId}, 'cancelled', 1, 1, 1, 1)
      `;
      await sql`
        UPDATE "chapters"
        SET "active_translation_job_id" = NULL, "translation_generation" = 1, "status" = 'raw'
        WHERE "id" = ${fixture.chapterId}
      `;

      await expect(
        completeJob({
          jobId,
          generation: 1,
          fullTranslation: "Cancelled translation",
          storySummary: "Cancelled summary",
          glossaryRows: [],
          logsJson: "[]",
          usageJson: "{}",
        }),
      ).resolves.toBe(false);

      const [chapter] = await sql<{ translatedContent: string | null }[]>`
        SELECT "translated_content" AS "translatedContent" FROM "chapters"
        WHERE "id" = ${fixture.chapterId}
      `;
      expect(chapter.translatedContent).toBeNull();
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("rejects replacement-during-finalize and preserves the replacement owner", async () => {
    const fixture = await seedChapter();
    const staleJobId = `job-${randomUUID()}`;
    const replacementJobId = `job-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks"
        ) VALUES (${staleJobId}, ${fixture.chapterId}, 'cancelled', 1, 1, 1, 1)
      `;
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks"
        ) VALUES (${replacementJobId}, ${fixture.chapterId}, 'running', 1, 2, 1, 0)
      `;
      await sql`
        UPDATE "chapters"
        SET "active_translation_job_id" = ${replacementJobId},
            "translation_generation" = 2, "status" = 'translating'
        WHERE "id" = ${fixture.chapterId}
      `;

      await expect(
        completeJob({
          jobId: staleJobId,
          generation: 1,
          fullTranslation: "Stale replacement",
          storySummary: "Stale summary",
          glossaryRows: [],
          logsJson: "[]",
          usageJson: "{}",
        }),
      ).resolves.toBe(false);

      const [chapter] = await sql<
        { translatedContent: string | null; activeJobId: string | null }[]
      >`
        SELECT "translated_content" AS "translatedContent",
               "active_translation_job_id" AS "activeJobId"
        FROM "chapters" WHERE "id" = ${fixture.chapterId}
      `;
      expect(chapter).toEqual({ translatedContent: null, activeJobId: replacementJobId });
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("persists one completed chunk and advances the cursor atomically", async () => {
    const fixture = await seedChapter("One chunk only.");
    const jobId = `job-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks"
        ) VALUES (${jobId}, ${fixture.chapterId}, 'running', 1, 1, 1, 0)
      `;
      await sql`
        INSERT INTO "translation_job_chunks" ("job_id", "chunk_index", "source_text", "text_length")
        VALUES (${jobId}, 0, 'One chunk only.', 15)
      `;
      await sql`
        UPDATE "chapters"
        SET "active_translation_job_id" = ${jobId}, "translation_generation" = 1,
            "status" = 'translating'
        WHERE "id" = ${fixture.chapterId}
      `;

      await expect(
        completeChunk(jobId, 1, 0, {
          translation: "Translated once.",
          promptTokens: 4,
          completionTokens: 3,
          latencyMs: 20,
          logsJson: "[]",
        }),
      ).resolves.toBe(true);
      await expect(
        completeChunk(jobId, 1, 0, {
          translation: "Duplicate write.",
          promptTokens: 9,
          completionTokens: 9,
          latencyMs: 99,
          logsJson: "[]",
        }),
      ).resolves.toBe(false);

      const [job] = await sql<{ doneChunks: number }[]>`
        SELECT "done_chunks" AS "doneChunks" FROM "translation_jobs" WHERE "id" = ${jobId}
      `;
      const [chunk] = await sql<{ translation: string | null }[]>`
        SELECT "translation" FROM "translation_job_chunks"
        WHERE "job_id" = ${jobId} AND "chunk_index" = 0
      `;
      expect(job.doneChunks).toBe(1);
      expect(chunk.translation).toBe("Translated once.");
    } finally {
      await deleteFixture(fixture.userId);
    }
  });
});
