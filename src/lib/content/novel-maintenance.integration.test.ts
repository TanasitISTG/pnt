import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let deleteAllNovelTranslationsForUser: typeof import("./chapter-ops.service").deleteAllNovelTranslationsForUser;
let deleteAllGlossaryTermsForUser: typeof import("../glossary/service").deleteAllGlossaryTermsForUser;
let rejectAllPendingGlossaryTermsForUser: typeof import("../glossary/service").rejectAllPendingGlossaryTermsForUser;
const skipEagerDispatch = async () => {};

type MaintenanceFixture = {
  ownerUserId: string;
  otherUserId: string;
  novelId: string;
  otherNovelId: string;
  translatedChapterId: string;
  runningChapterId: string;
  rawChapterId: string;
  artifactChapterId: string;
  doneJobId: string;
  runningJobId: string;
  approvedTermId: string;
  pendingTermId: string;
  rejectedTermId: string;
  otherTermIds: string[];
};

type NovelSnapshot = {
  novel: {
    storySummary: string | null;
    publishedAt: string | null;
    updatedAt: string;
  };
  chapters: Array<{
    id: string;
    rawContent: string;
    status: string;
    translatedContent: string | null;
    translatedTitle: string | null;
    summary: string | null;
    activeJobId: string | null;
    sourceRevision: number;
    translationGeneration: number;
    publishedAt: string | null;
    updatedAt: string;
  }>;
  jobs: Array<{
    id: string;
    status: string;
    generation: number;
    usageJson: string | null;
  }>;
  terms: Array<{ id: string; status: string }>;
};

async function seedMaintenanceFixture(): Promise<MaintenanceFixture> {
  const ownerUserId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const otherNovelId = `novel-${randomUUID()}`;
  const translatedChapterId = `chapter-${randomUUID()}`;
  const runningChapterId = `chapter-${randomUUID()}`;
  const rawChapterId = `chapter-${randomUUID()}`;
  const artifactChapterId = `chapter-${randomUUID()}`;
  const doneJobId = `job-${randomUUID()}`;
  const runningJobId = `job-${randomUUID()}`;
  const approvedTermId = `term-${randomUUID()}`;
  const pendingTermId = `term-${randomUUID()}`;
  const rejectedTermId = `term-${randomUUID()}`;
  const otherTermIds = [`term-${randomUUID()}`, `term-${randomUUID()}`];
  const novelPublishedAt = "2024-01-02T03:04:05.000Z";
  const chapterPublishedAt = "2024-02-03T04:05:06.000Z";

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ownerUserId}, 'Maintenance Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other Owner', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "story_summary", "published_at",
      "created_at", "updated_at"
    ) VALUES
      (${novelId}, ${ownerUserId}, 'Maintenance Novel', 'zh', 'en', 'Rolling story summary', ${novelPublishedAt}, now(), now()),
      (${otherNovelId}, ${otherUserId}, 'Other Novel', 'zh', 'en', 'Other story summary', ${novelPublishedAt}, now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "translated_title", "raw_content", "translated_content",
      "status", "summary", "raw_char_count", "source_revision", "translation_generation",
      "active_translation_job_id", "published_at", "translated_at", "edited_at", "created_at", "updated_at"
    ) VALUES
      (
        ${translatedChapterId}, ${novelId}, 1, 'Translated chapter', 'Translated title',
        'Raw translated chapter', 'Translated chapter body', 'translated', 'Chapter summary',
        22, 7, 3, NULL, ${chapterPublishedAt}, now(), now(), now(), now()
      ),
      (
        ${runningChapterId}, ${novelId}, 2, 'Running chapter', 'Running title',
        'Raw running chapter', 'Running translation body', 'translating', 'Running summary',
        20, 8, 4, ${runningJobId}, ${chapterPublishedAt}, now(), NULL, now(), now()
      ),
      (
        ${rawChapterId}, ${novelId}, 3, 'Raw chapter', NULL,
        'Raw chapter body', NULL, 'raw', NULL,
        15, 9, 0, NULL, ${chapterPublishedAt}, NULL, NULL, now(), now()
      ),
      (
        ${artifactChapterId}, ${novelId}, 4, 'Artifact-only chapter', 'Stale title',
        'Raw artifact chapter', NULL, 'raw', NULL,
        21, 10, 2, NULL, ${chapterPublishedAt}, NULL, NULL, now(), now()
      )
  `;
  await sql`
    UPDATE "chapters"
    SET "translated_title" = 'Stale title', "edited_at" = now()
    WHERE "id" = ${artifactChapterId}
  `;
  await sql`
    INSERT INTO "translation_jobs" (
      "id", "chapter_id", "status", "source_revision", "generation", "total_chunks", "done_chunks",
      "usage_json", "logs_json", "created_at", "updated_at"
    ) VALUES
      (
        ${doneJobId}, ${translatedChapterId}, 'done', 7, 3, 1, 1,
        '{"promptTokens":12,"completionTokens":8}', '[]', now(), now()
      ),
      (
        ${runningJobId}, ${runningChapterId}, 'running', 8, 4, 1, 0,
        '{"promptTokens":5,"completionTokens":3}', '[]', now(), now()
      )
  `;
  await sql`
    INSERT INTO "translation_job_chunks" (
      "job_id", "chunk_index", "source_text", "text_length", "translation",
      "prompt_tokens", "completion_tokens", "latency_ms", "completed_at"
    ) VALUES
      (${doneJobId}, 0, 'Done source', 11, 'Done translation', 12, 8, 120, now()),
      (${runningJobId}, 0, 'Running source', 14, NULL, NULL, NULL, NULL, NULL)
  `;
  await sql`
    INSERT INTO "glossary_terms" ("id", "novel_id", "source", "target", "category", "status") VALUES
      (${approvedTermId}, ${novelId}, 'Approved source', 'Approved target', 'character', 'approved'),
      (${pendingTermId}, ${novelId}, 'Pending source', 'Pending target', 'place', 'pending'),
      (${rejectedTermId}, ${novelId}, 'Rejected source', 'Rejected target', 'item', 'rejected'),
      (${otherTermIds[0]}, ${otherNovelId}, 'Other approved', 'Other approved target', 'other', 'approved'),
      (${otherTermIds[1]}, ${otherNovelId}, 'Other pending', 'Other pending target', 'skill', 'pending')
  `;

  return {
    ownerUserId,
    otherUserId,
    novelId,
    otherNovelId,
    translatedChapterId,
    runningChapterId,
    rawChapterId,
    artifactChapterId,
    doneJobId,
    runningJobId,
    approvedTermId,
    pendingTermId,
    rejectedTermId,
    otherTermIds,
  };
}

async function readNovelSnapshot(novelId: string): Promise<NovelSnapshot> {
  const [novel] = await sql<NovelSnapshot["novel"][]>`
    SELECT
      "story_summary" AS "storySummary",
      "published_at"::text AS "publishedAt",
      "updated_at"::text AS "updatedAt"
    FROM "novels"
    WHERE "id" = ${novelId}
  `;
  const chapters = (
    await sql<NovelSnapshot["chapters"]>`
      SELECT
        "id",
        "raw_content" AS "rawContent",
        "status",
        "translated_content" AS "translatedContent",
        "translated_title" AS "translatedTitle",
        "summary",
        "active_translation_job_id" AS "activeJobId",
        "source_revision" AS "sourceRevision",
        "translation_generation" AS "translationGeneration",
        "published_at"::text AS "publishedAt",
        "updated_at"::text AS "updatedAt"
      FROM "chapters"
      WHERE "novel_id" = ${novelId}
      ORDER BY "id"
    `
  ).map((chapter) => ({
    ...chapter,
    sourceRevision: Number(chapter.sourceRevision),
    translationGeneration: Number(chapter.translationGeneration),
  }));
  const jobs = (
    await sql<NovelSnapshot["jobs"]>`
      SELECT
        tj."id" AS "id",
        tj."status" AS "status",
        tj."generation" AS "generation",
        tj."usage_json" AS "usageJson"
      FROM "translation_jobs" tj
      INNER JOIN "chapters" c ON c."id" = tj."chapter_id"
      WHERE c."novel_id" = ${novelId}
      ORDER BY tj."id"
    `
  ).map((job) => ({
    ...job,
    generation: Number(job.generation),
  }));
  const terms = await sql<NovelSnapshot["terms"]>`
    SELECT "id", "status"
    FROM "glossary_terms"
    WHERE "novel_id" = ${novelId}
    ORDER BY "id"
  `;

  if (!novel) throw new Error(`Missing novel fixture ${novelId}`);
  return { novel, chapters, jobs, terms };
}

async function readJobChunks(jobIds: string[]) {
  const chunks = await sql<
    Array<{
      jobId: string;
      index: number;
      sourceText: string;
      translation: string | null;
      promptTokens: number | null;
      completionTokens: number | null;
    }>
  >`
    SELECT
      "job_id" AS "jobId",
      "chunk_index" AS "index",
      "source_text" AS "sourceText",
      "translation",
      "prompt_tokens" AS "promptTokens",
      "completion_tokens" AS "completionTokens"
    FROM "translation_job_chunks"
    WHERE "job_id" IN (${jobIds[0]}, ${jobIds[1]})
    ORDER BY "job_id", "chunk_index"
  `;
  return chunks.map((chunk) => ({
    ...chunk,
    index: Number(chunk.index),
    promptTokens: chunk.promptTokens === null ? null : Number(chunk.promptTokens),
    completionTokens: chunk.completionTokens === null ? null : Number(chunk.completionTokens),
  }));
}

async function deleteFixture(fixture: MaintenanceFixture) {
  await sql`
    DELETE FROM "translation_outbox"
    WHERE "payload_json"::jsonb ->> 'jobId' IN (${fixture.doneJobId}, ${fixture.runningJobId})
  `;
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerUserId}, ${fixture.otherUserId})`;
}

integrationDescribe("novel maintenance PostgreSQL invariants", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({ deleteAllNovelTranslationsForUser } = await import("./chapter-ops.service"));
    ({ deleteAllGlossaryTermsForUser, rejectAllPendingGlossaryTermsForUser } =
      await import("../glossary/service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("enforces ownership, resets translation artifacts, and retains history", async () => {
    const fixture = await seedMaintenanceFixture();
    try {
      const ownerBefore = await readNovelSnapshot(fixture.novelId);
      const otherBefore = await readNovelSnapshot(fixture.otherNovelId);

      await expect(
        deleteAllNovelTranslationsForUser(fixture.otherUserId, fixture.novelId, skipEagerDispatch),
      ).rejects.toThrow("Novel not found or unauthorized");
      await expect(
        rejectAllPendingGlossaryTermsForUser(fixture.otherUserId, fixture.novelId),
      ).rejects.toThrow("Novel not found or unauthorized");
      await expect(
        deleteAllGlossaryTermsForUser(fixture.otherUserId, fixture.novelId),
      ).rejects.toThrow("Novel not found or unauthorized");

      expect(await readNovelSnapshot(fixture.novelId)).toEqual(ownerBefore);
      expect(await readNovelSnapshot(fixture.otherNovelId)).toEqual(otherBefore);

      await expect(
        deleteAllNovelTranslationsForUser(fixture.ownerUserId, fixture.novelId, skipEagerDispatch),
      ).resolves.toEqual({ chaptersCleared: 3, jobsCancelled: 1 });

      const resetSnapshot = await readNovelSnapshot(fixture.novelId);
      expect(resetSnapshot.novel.storySummary).toBeNull();
      expect(resetSnapshot.novel.publishedAt).toBe(ownerBefore.novel.publishedAt);

      const translatedChapter = resetSnapshot.chapters.find(
        (chapter) => chapter.id === fixture.translatedChapterId,
      );
      const runningChapter = resetSnapshot.chapters.find(
        (chapter) => chapter.id === fixture.runningChapterId,
      );
      const rawChapter = resetSnapshot.chapters.find(
        (chapter) => chapter.id === fixture.rawChapterId,
      );
      const artifactChapter = resetSnapshot.chapters.find(
        (chapter) => chapter.id === fixture.artifactChapterId,
      );

      for (const chapter of [translatedChapter, runningChapter, artifactChapter]) {
        expect(chapter).toMatchObject({
          status: "raw",
          translatedContent: null,
          translatedTitle: null,
          summary: null,
          activeJobId: null,
          publishedAt: ownerBefore.chapters.find((before) => before.id === chapter?.id)
            ?.publishedAt,
        });
      }
      expect(rawChapter).toMatchObject({
        rawContent: "Raw chapter body",
        status: "raw",
        translatedContent: null,
        translatedTitle: null,
        summary: null,
        sourceRevision: 9,
        translationGeneration: 0,
        publishedAt: ownerBefore.chapters.find((chapter) => chapter.id === fixture.rawChapterId)
          ?.publishedAt,
      });
      expect(translatedChapter).toMatchObject({
        rawContent: "Raw translated chapter",
        sourceRevision: 7,
        translationGeneration: 3,
      });
      expect(runningChapter).toMatchObject({
        rawContent: "Raw running chapter",
        sourceRevision: 8,
        translationGeneration: 4,
      });

      expect(resetSnapshot.jobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: fixture.doneJobId,
            status: "done",
            usageJson: '{"promptTokens":12,"completionTokens":8}',
          }),
          expect.objectContaining({ id: fixture.runningJobId, status: "cancelled" }),
        ]),
      );
      const retainedChunks = await readJobChunks([fixture.doneJobId, fixture.runningJobId]);
      expect(retainedChunks).toHaveLength(2);
      expect(retainedChunks).toEqual(
        expect.arrayContaining([
          {
            jobId: fixture.doneJobId,
            index: 0,
            sourceText: "Done source",
            translation: "Done translation",
            promptTokens: 12,
            completionTokens: 8,
          },
          {
            jobId: fixture.runningJobId,
            index: 0,
            sourceText: "Running source",
            translation: null,
            promptTokens: null,
            completionTokens: null,
          },
        ]),
      );

      const cancellationEvents = await sql<
        Array<{ status: string; payload: { jobId: string; generation: number } }>
      >`
        SELECT "status", "payload_json"::jsonb AS "payload"
        FROM "translation_outbox"
        WHERE "event_name" = 'translation/job.cancelled'
          AND "payload_json"::jsonb ->> 'jobId' = ${fixture.runningJobId}
      `;
      expect(cancellationEvents).toEqual([
        {
          status: "pending",
          payload: { jobId: fixture.runningJobId, generation: 4 },
        },
      ]);

      const [beforeRepeat] = await sql<{ updatedAt: string }[]>`
        SELECT "updated_at"::text AS "updatedAt" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      await expect(
        deleteAllNovelTranslationsForUser(fixture.ownerUserId, fixture.novelId, skipEagerDispatch),
      ).resolves.toEqual({ chaptersCleared: 0, jobsCancelled: 0 });
      const [afterRepeat] = await sql<{ updatedAt: string }[]>`
        SELECT "updated_at"::text AS "updatedAt" FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(afterRepeat.updatedAt).toBe(beforeRepeat.updatedAt);
      const repeatedEvents = await sql`
        SELECT "id"
        FROM "translation_outbox"
        WHERE "event_name" = 'translation/job.cancelled'
          AND "payload_json"::jsonb ->> 'jobId' = ${fixture.runningJobId}
      `;
      expect(repeatedEvents).toHaveLength(1);

      await sql`
        UPDATE "chapters"
        SET "translated_content" = 'Keep chapter text'
        WHERE "id" = ${fixture.rawChapterId}
      `;
      const [chapterBeforeGlossaryDelete] = await sql<{ translatedContent: string | null }[]>`
        SELECT "translated_content" AS "translatedContent"
        FROM "chapters" WHERE "id" = ${fixture.rawChapterId}
      `;

      await expect(
        rejectAllPendingGlossaryTermsForUser(fixture.ownerUserId, fixture.novelId),
      ).resolves.toEqual({ rejected: 1 });
      const rejectedSnapshot = await readNovelSnapshot(fixture.novelId);
      expect(rejectedSnapshot.terms).toEqual(
        expect.arrayContaining([
          { id: fixture.approvedTermId, status: "approved" },
          { id: fixture.pendingTermId, status: "rejected" },
          { id: fixture.rejectedTermId, status: "rejected" },
        ]),
      );
      expect(await readNovelSnapshot(fixture.otherNovelId)).toEqual(otherBefore);

      await expect(
        rejectAllPendingGlossaryTermsForUser(fixture.ownerUserId, fixture.novelId),
      ).resolves.toEqual({ rejected: 0 });
      await expect(
        deleteAllGlossaryTermsForUser(fixture.ownerUserId, fixture.novelId),
      ).resolves.toEqual({ deleted: 3 });
      expect((await readNovelSnapshot(fixture.novelId)).terms).toHaveLength(0);
      expect(await readNovelSnapshot(fixture.otherNovelId)).toEqual(otherBefore);

      const [chapterAfterGlossaryDelete] = await sql<{ translatedContent: string | null }[]>`
        SELECT "translated_content" AS "translatedContent"
        FROM "chapters" WHERE "id" = ${fixture.rawChapterId}
      `;
      expect(chapterAfterGlossaryDelete).toEqual(chapterBeforeGlossaryDelete);

      await expect(
        deleteAllGlossaryTermsForUser(fixture.ownerUserId, fixture.novelId),
      ).resolves.toEqual({ deleted: 0 });
    } finally {
      await deleteFixture(fixture);
    }
  }, 30_000);
});
