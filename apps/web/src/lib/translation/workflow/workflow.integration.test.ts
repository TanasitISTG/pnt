import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { sql as drizzleSql } from "drizzle-orm";

import { relationshipAnalysisSchema } from "@/lib/relationships/schemas";
import type * as RelationshipService from "@/lib/relationships/service";
import type * as ChapterEditService from "@/lib/content/chapter/chapter-edit.service";
import type * as GlossaryService from "@/lib/glossary/service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let completeChunk: typeof import("./job-store").completeChunk;
let completeJob: typeof import("./job-store").completeJob;
let applyRelationshipAnalysis: typeof import("./job-store").applyRelationshipAnalysis;
let enqueueTranslationJob: typeof import("../api/mutations").enqueueTranslationJob;
let setRelationshipEntryEnabledForUser: typeof RelationshipService.setRelationshipEntryEnabledForUser;
let setRelationshipEntryAutoManagedForUser: typeof RelationshipService.setRelationshipEntryAutoManagedForUser;
let upsertCharacterProfileForUser: typeof RelationshipService.upsertCharacterProfileForUser;
let getRelationshipMapForUser: typeof RelationshipService.getRelationshipMapForUser;
let getRelationshipWorkspaceForUser: typeof RelationshipService.getRelationshipWorkspaceForUser;
let findOwnedTranslationJob: typeof import("../api/job-query.service").findOwnedTranslationJob;
let findOwnedTranslationJobProgress: typeof import("../api/job-query.service").findOwnedTranslationJobProgress;
let loadTranslationRunContext: typeof import("./run-context").loadTranslationRunContext;
let updateChapterForUser: typeof ChapterEditService.updateChapterForUser;
let updateGlossaryTermAtomic: typeof GlossaryService.updateGlossaryTermAtomic;
const skipEagerDispatch = async () => {};

async function pauseNextNovelGate() {
  const { db } = await import("@/lib/db");
  const transaction = db.transaction.bind(db);
  let release!: () => void;
  let acquired!: (pid: number) => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<number>((resolve) => {
    acquired = resolve;
  });
  let claimed = false;
  const spy = vi.spyOn(db, "transaction").mockImplementation((callback, config) =>
    transaction(async (tx) => {
      const [{ pid }] = await tx.execute<{ pid: number }>(
        drizzleSql`SELECT pg_backend_pid() AS pid`,
      );
      const originalSelect = tx.select;
      // Wrap execution only: rows, builders, locks and transaction connections remain real.
      tx.select = new Proxy(originalSelect, {
        apply(select, _thisArg, args) {
          const builder: ReturnType<typeof originalSelect> = Reflect.apply(select, tx, args);
          const originalFrom = builder.from;
          builder.from = new Proxy(originalFrom, {
            apply(from, _fromThis, fromArgs) {
              const query: ReturnType<typeof originalFrom> = Reflect.apply(from, builder, fromArgs);
              const originalExecute = query.execute;
              query.execute = new Proxy(originalExecute, {
                async apply(execute, _executeThis, executeArgs) {
                  const rows = await Reflect.apply(execute, query, executeArgs);
                  const text = query.toSQL().sql;
                  if (
                    !claimed &&
                    /from "novels"/i.test(text) &&
                    /for update(?: of "novels")?\s*$/i.test(text)
                  ) {
                    claimed = true;
                    acquired(pid);
                    await bounded(released);
                  }
                  return rows;
                },
              });
              return query;
            },
          });
          return builder;
        },
      });
      return callback(tx);
    }, config),
  );
  return { locked, release, restore: () => spy.mockRestore() };
}

// Real database waits cannot use fake timers; this is a failure deadline, never a scheduling delay.
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Novel gate barrier timed out")), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForNovelWaiter(blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await sql`
      SELECT pid FROM pg_stat_activity
      WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
        AND wait_event_type = 'Lock'
        AND query LIKE '%for update%'
        AND query LIKE '%novels%'
    `;
    if (rows.length > 0) return;
  }
  throw new Error("Competing mutation never waited on the novel gate");
}

async function seedChapter(
  rawContent = "First paragraph.\n\nSecond paragraph.",
  targetLang = "en",
  sourceLang = "zh",
) {
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
    ) VALUES (${novelId}, ${userId}, 'Integration Novel', ${sourceLang}, ${targetLang}, now(), now())
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

function relationshipAnalysisFixture() {
  return relationshipAnalysisSchema.parse({
    characters: [
      {
        sourceName: "父亲",
        targetName: "พ่อ",
        aliases: [],
        gender: "male",
        role: "father",
        notes: null,
        evidence: "父亲",
      },
      {
        sourceName: "儿子",
        targetName: "ลูกชาย",
        aliases: [],
        gender: "male",
        role: "son",
        notes: null,
        evidence: "儿子",
      },
    ],
    relationships: [
      {
        speaker: "儿子",
        listener: "父亲",
        relationship: "son",
        speakerStatus: "lower",
        familiarity: "close",
        register: "respectful",
        notes: null,
        evidence: "儿子",
      },
    ],
    activePairs: [{ speaker: "儿子", listener: "父亲", evidence: "儿子" }],
  });
}

async function seedRunningAnalysisJob(
  fixture: { chapterId: string },
  jobId: string,
  generation = 1,
  sourceRevision = 1,
) {
  await sql`
    INSERT INTO "translation_jobs" (
      "id", "chapter_id", "status", "source_revision", "generation",
      "total_chunks", "done_chunks"
    ) VALUES (${jobId}, ${fixture.chapterId}, 'running', ${sourceRevision}, ${generation}, 1, 0)
  `;
  await sql`
    INSERT INTO "translation_job_chunks" ("job_id", "chunk_index", "source_text", "text_length")
    VALUES (${jobId}, 0, '儿子对父亲说：我会回来的。', 16)
  `;
  await sql`
    UPDATE "chapters"
    SET "active_translation_job_id" = ${jobId},
        "translation_generation" = ${generation},
        "source_revision" = ${sourceRevision},
        "status" = 'translating'
    WHERE "id" = ${fixture.chapterId}
  `;
}
integrationDescribe("translation workflow PostgreSQL invariants", () => {
  // Load server modules only after DATABASE_URL points at the isolated integration database.
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({ completeChunk, completeJob, applyRelationshipAnalysis } = await import("./job-store"));
    ({ enqueueTranslationJob } = await import("../api/mutations"));
    ({ updateChapterForUser } = await import("@/lib/content/chapter/chapter-edit.service"));
    ({ updateGlossaryTermAtomic } = await import("@/lib/glossary/service"));
    ({ findOwnedTranslationJob, findOwnedTranslationJobProgress } =
      await import("../api/job-query.service"));
    ({ loadTranslationRunContext } = await import("./run-context"));
    ({
      setRelationshipEntryEnabledForUser,
      setRelationshipEntryAutoManagedForUser,
      upsertCharacterProfileForUser,
      getRelationshipMapForUser,
      getRelationshipWorkspaceForUser,
    } = await import("@/lib/relationships/service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  for (const winner of ["edit", "worker"] as const) {
    it(`serializes source edit and chunk completion with ${winner} winning the novel gate`, async () => {
      const fixture = await seedChapter();
      const jobId = `job-${randomUUID()}`;
      const gate = await pauseNextNovelGate();
      let first: Promise<unknown> | undefined;
      let second: Promise<unknown> | undefined;
      try {
        await seedRunningAnalysisJob(fixture, jobId, 2, 4);
        const edit = () =>
          updateChapterForUser(
            fixture.userId,
            {
              chapterId: fixture.chapterId,
              rawContent: "Changed raw",
              sourceChangePolicy: "clear",
            },
            skipEagerDispatch,
          );
        const commit = () =>
          completeChunk(jobId, 2, 0, {
            translation: "worker output",
            promptTokens: 1,
            completionTokens: 1,
            latencyMs: 1,
            logsJson: "[]",
          });
        first = winner === "edit" ? edit() : commit();
        const blockerPid = await bounded(gate.locked);
        second = winner === "edit" ? commit() : edit();
        await waitForNovelWaiter(blockerPid);
        gate.release();
        const [firstResult, secondResult] = await bounded(Promise.all([first, second]));
        expect(winner === "worker" ? firstResult : secondResult).toBe(winner === "worker");
        const [chapter] = await sql`
          SELECT source_revision, active_translation_job_id, translated_content, summary, status
          FROM chapters WHERE id = ${fixture.chapterId}
        `;
        expect(chapter).toMatchObject({
          source_revision: 5,
          active_translation_job_id: null,
          translated_content: null,
          summary: null,
          status: "raw",
        });
        const [job] =
          await sql`SELECT status, done_chunks FROM translation_jobs WHERE id = ${jobId}`;
        expect(job).toMatchObject({
          status: "cancelled",
          done_chunks: winner === "worker" ? 1 : 0,
        });
        const [chunk] =
          await sql`SELECT translation, completed_at FROM translation_job_chunks WHERE job_id = ${jobId}`;
        expect(chunk.translation).toBe(winner === "worker" ? "worker output" : null);
        expect(chunk.completed_at !== null).toBe(winner === "worker");
        const events = await sql`
          SELECT payload_json FROM workflow_outbox
          WHERE event_name = 'translation/job.cancelled' AND payload_json::jsonb->>'jobId' = ${jobId}
        `;
        expect(events.map((event) => JSON.parse(event.payload_json))).toEqual([
          { jobId, generation: 2 },
        ]);
      } finally {
        gate.release();
        await Promise.allSettled([first, second]);
        gate.restore();
        await sql`DELETE FROM workflow_outbox WHERE payload_json::jsonb->>'jobId' = ${jobId}`;
        await deleteFixture(fixture.userId);
      }
    });
  }

  for (const winner of ["glossary", "worker"] as const) {
    it(`rereads final translation under glossary propagation with ${winner} winning the novel gate`, async () => {
      const fixture = await seedChapter();
      const jobId = `job-${randomUUID()}`;
      const termId = `term-${randomUUID()}`;
      const generatedTermId = `term-${randomUUID()}`;
      const gate = await pauseNextNovelGate();
      let first: Promise<unknown> | undefined;
      let second: Promise<unknown> | undefined;
      try {
        await seedRunningAnalysisJob(fixture, jobId, 2, 4);
        await sql`UPDATE translation_jobs SET done_chunks = 1 WHERE id = ${jobId}`;
        await sql`UPDATE chapters SET translated_content = 'Old Name retained', summary = 'Old summary' WHERE id = ${fixture.chapterId}`;
        await sql`INSERT INTO glossary_terms (id, novel_id, source, target, category, status)
          VALUES (${termId}, ${fixture.novelId}, 'Name', 'Old Name', 'character', 'approved')`;
        const propagate = () =>
          updateGlossaryTermAtomic(
            fixture.userId,
            {
              termId,
              target: "New Name",
              applyToChapters: true,
            },
            skipEagerDispatch,
          );
        const finalize = () =>
          completeJob({
            jobId,
            generation: 2,
            fullTranslation: "Old Name arrived",
            chapterSummary: "Worker summary",
            storySummary: "Worker story",
            glossaryRows: [
              {
                id: generatedTermId,
                novelId: fixture.novelId,
                source: "Another",
                target: "Another",
                category: "other",
                status: "approved",
              },
            ],
            logsJson: "[]",
            usageJson: "{}",
          });
        first = winner === "glossary" ? propagate() : finalize();
        const blockerPid = await bounded(gate.locked);
        second = winner === "glossary" ? finalize() : propagate();
        await waitForNovelWaiter(blockerPid);
        gate.release();
        const [firstResult, secondResult] = await bounded(Promise.all([first, second]));
        expect(winner === "worker" ? firstResult : secondResult).toBe(winner === "worker");
        const [chapter] =
          await sql`SELECT translated_content, summary, active_translation_job_id FROM chapters WHERE id = ${fixture.chapterId}`;
        expect(chapter).toMatchObject({
          translated_content: winner === "worker" ? "New Name arrived" : "New Name retained",
          summary: null,
          active_translation_job_id: null,
        });
        const [novel] = await sql`SELECT story_summary FROM novels WHERE id = ${fixture.novelId}`;
        expect(novel.story_summary).toBeNull();
        const [job] = await sql`SELECT status FROM translation_jobs WHERE id = ${jobId}`;
        expect(job.status).toBe(winner === "worker" ? "done" : "cancelled");
        const terms = await sql`SELECT id FROM glossary_terms WHERE id = ${generatedTermId}`;
        expect(terms.map((term) => term.id)).toEqual(winner === "worker" ? [generatedTermId] : []);
        const events = await sql`SELECT payload_json FROM workflow_outbox
          WHERE event_name = 'translation/job.cancelled' AND payload_json::jsonb->>'jobId' = ${jobId}`;
        expect(events.map((event) => JSON.parse(event.payload_json))).toEqual(
          winner === "worker" ? [] : [{ jobId, generation: 2 }],
        );
      } finally {
        gate.release();
        await Promise.allSettled([first, second]);
        gate.restore();
        await sql`DELETE FROM workflow_outbox WHERE payload_json::jsonb->>'jobId' = ${jobId}`;
        await deleteFixture(fixture.userId);
      }
    });
  }

  it("does not block another novel's worker while one novel gate is held", async () => {
    const firstFixture = await seedChapter();
    const secondFixture = await seedChapter();
    const firstJob = `job-${randomUUID()}`;
    const secondJob = `job-${randomUUID()}`;
    const gate = await pauseNextNovelGate();
    let first: Promise<boolean> | undefined;
    try {
      await seedRunningAnalysisJob(firstFixture, firstJob);
      await seedRunningAnalysisJob(secondFixture, secondJob);
      const result = {
        translation: "completed",
        promptTokens: 1,
        completionTokens: 1,
        latencyMs: 1,
        logsJson: "[]",
      };
      first = completeChunk(firstJob, 1, 0, result);
      await bounded(gate.locked);
      expect(await bounded(completeChunk(secondJob, 1, 0, result))).toBe(true);
      const [secondRow] =
        await sql`SELECT done_chunks FROM translation_jobs WHERE id = ${secondJob}`;
      expect(secondRow.done_chunks).toBe(1);
      gate.release();
      expect(await bounded(first)).toBe(true);
    } finally {
      gate.release();
      await Promise.allSettled([first]);
      gate.restore();
      await deleteFixture(firstFixture.userId);
      await deleteFixture(secondFixture.userId);
    }
  });

  it("rejects foreign-parent glossary finalization atomically", async () => {
    const fixture = await seedChapter();
    const foreign = await seedChapter();
    const jobId = `job-${randomUUID()}`;
    const termId = `term-${randomUUID()}`;
    try {
      await seedRunningAnalysisJob(fixture, jobId);
      await sql`UPDATE translation_jobs SET done_chunks = 1 WHERE id = ${jobId}`;
      await expect(
        completeJob({
          jobId,
          generation: 1,
          fullTranslation: "Must roll back",
          storySummary: "Must roll back",
          glossaryRows: [
            {
              id: termId,
              novelId: foreign.novelId,
              source: "Wrong parent",
              target: "Wrong parent",
              category: "other",
              status: "approved",
            },
          ],
          logsJson: "[]",
          usageJson: "{}",
        }),
      ).rejects.toThrow("Finalization glossary terms must belong to the job's novel");
      const [chapter] =
        await sql`SELECT translated_content, active_translation_job_id FROM chapters WHERE id = ${fixture.chapterId}`;
      expect(chapter).toMatchObject({ translated_content: null, active_translation_job_id: jobId });
      const [novel] = await sql`SELECT story_summary FROM novels WHERE id = ${fixture.novelId}`;
      expect(novel.story_summary).toBeNull();
      const [job] = await sql`SELECT status FROM translation_jobs WHERE id = ${jobId}`;
      expect(job.status).toBe("running");
      expect(await sql`SELECT id FROM glossary_terms WHERE id = ${termId}`).toEqual([]);
    } finally {
      await deleteFixture(fixture.userId);
      await deleteFixture(foreign.userId);
    }
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
        enqueueTranslationJob(
          fixture.userId,
          fixture.chapterId,
          provider,
          "missing",
          skipEagerDispatch,
        ),
        enqueueTranslationJob(
          fixture.userId,
          fixture.chapterId,
          provider,
          "missing",
          skipEagerDispatch,
        ),
      ]);

      const jobs = await sql<{ id: string; status: string; generation: number }[]>`
        SELECT "id", "status", "generation"
        FROM "translation_jobs" WHERE "chapter_id" = ${fixture.chapterId}
      `;
      const [chapter] = await sql<{ activeJobId: string | null; generation: number }[]>`
        SELECT "active_translation_job_id" AS "activeJobId", "translation_generation" AS "generation"
        FROM "chapters" WHERE "id" = ${fixture.chapterId}
      `;

      expect(results).toHaveLength(2);
      const pendingJob = jobs.find((job) => job.status === "pending");
      const cancelledJob = jobs.find((job) => job.status === "cancelled");
      const [cancelEvent] = await sql<{ payload: { jobId: string; generation: number } }[]>`
        SELECT "payload_json"::jsonb AS "payload"
        FROM "workflow_outbox"
        WHERE "event_name" = 'translation/job.cancelled'
          AND "payload_json"::jsonb->>'jobId' = ${cancelledJob?.id ?? ""}
        ORDER BY "created_at" DESC
        LIMIT 1
      `;
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

  it("skips existing translations unless overwrite mode is explicit", async () => {
    const fixture = await seedChapter();
    try {
      await sql`
        UPDATE "chapters"
        SET "translated_content" = 'Existing translation', "status" = 'translated'
        WHERE "id" = ${fixture.chapterId}
      `;
      const provider = { model: "integration-model" } as never;

      await expect(
        enqueueTranslationJob(
          fixture.userId,
          fixture.chapterId,
          provider,
          "missing",
          skipEagerDispatch,
        ),
      ).rejects.toThrow("already has a translation");

      const [unchanged] = await sql<
        {
          translatedContent: string | null;
          activeJobId: string | null;
        }[]
      >`
        SELECT "translated_content" AS "translatedContent",
               "active_translation_job_id" AS "activeJobId"
        FROM "chapters"
        WHERE "id" = ${fixture.chapterId}
      `;
      expect(unchanged).toEqual({
        translatedContent: "Existing translation",
        activeJobId: null,
      });
      expect(
        await sql`SELECT "id" FROM "translation_jobs" WHERE "chapter_id" = ${fixture.chapterId}`,
      ).toHaveLength(0);

      const queued = await enqueueTranslationJob(
        fixture.userId,
        fixture.chapterId,
        provider,
        "overwrite",
        skipEagerDispatch,
      );
      const [job] = await sql<{ overwriteExisting: boolean; status: string }[]>`
        SELECT "overwrite_existing" AS "overwriteExisting", "status"
        FROM "translation_jobs"
        WHERE "id" = ${queued.jobId}
      `;
      expect(job).toEqual({ overwriteExisting: true, status: "pending" });
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

  it("persists one analyzed relationship under the active job owner", async () => {
    const fixture = await seedChapter("儿子对父亲说：我会回来的。", "th");
    const jobId = `job-${randomUUID()}`;
    try {
      await expect(getRelationshipMapForUser(fixture.userId, fixture.novelId)).resolves.toEqual({
        version: 1,
        characters: [],
        relationships: [],
      });
      await expect(
        getRelationshipWorkspaceForUser(fixture.userId, fixture.novelId),
      ).resolves.toMatchObject({
        novel: { sourceLang: "zh", targetLang: "th" },
        map: { version: 1, characters: [], relationships: [] },
      });
      await seedRunningAnalysisJob(fixture, jobId);
      const result = await applyRelationshipAnalysis(jobId, 1, 0, relationshipAnalysisFixture());
      const storedMap = await getRelationshipMapForUser(fixture.userId, fixture.novelId);
      expect(storedMap.relationships).toEqual([
        expect.objectContaining({
          relationship: "son",
          speakerStatus: "lower",
          locked: false,
        }),
      ]);
      await expect(
        getRelationshipWorkspaceForUser(fixture.userId, fixture.novelId),
      ).resolves.toMatchObject({
        novel: { sourceLang: "zh", targetLang: "th" },
        map: { relationships: [expect.objectContaining({ relationship: "son" })] },
      });
      expect(result.applied).toBe(true);
      expect(result.map?.relationships).toHaveLength(1);

      const [novel] = await sql<
        {
          relationshipMap: {
            relationships: Array<{
              selfPronoun: string | null;
              addresseeTerm: string | null;
              sentenceParticles: string | null;
              locked: boolean;
            }>;
          };
        }[]
      >`
        SELECT "relationship_map_json"::jsonb AS "relationshipMap"
        FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(novel.relationshipMap.relationships).toEqual([
        expect.objectContaining({
          selfPronoun: null,
          addresseeTerm: null,
          sentenceParticles: null,
          locked: false,
        }),
      ]);
    } finally {
      await deleteFixture(fixture.userId);
    }
  });
  it("scrubs only an unlocked relationship and preserves the document through backup restore", async () => {
    const fixture = await seedChapter("儿子对父亲说：我会回来的。", "th");
    const jobId = `job-${randomUUID()}`;
    try {
      await seedRunningAnalysisJob(fixture, jobId);
      await applyRelationshipAnalysis(jobId, 1, 0, relationshipAnalysisFixture());
      const map = await getRelationshipMapForUser(fixture.userId, fixture.novelId);
      const original = {
        ...map.relationships[0]!,
        enabled: false,
        locked: true,
        selfPronoun: "ผม",
        addresseeTerm: "พ่อ",
        sentenceParticles: "ครับ",
        notes: "Keep semantic notes",
        evidence: "Keep evidence",
        lastSeenChapter: 5,
      };
      const other = {
        ...original,
        id: "reverse-pair",
        speakerId: original.listenerId,
        listenerId: original.speakerId,
        relationship: "father",
      };
      map.relationships = [original, other];
      map.characters[0] = { ...map.characters[0]!, enabled: false, locked: true };
      await sql`UPDATE novels SET relationship_map_json = ${JSON.stringify(map)} WHERE id = ${fixture.novelId}`;
      const [before] =
        await sql`SELECT source_revision, translation_generation, active_translation_job_id FROM chapters WHERE id = ${fixture.chapterId}`;
      const unlocked = await setRelationshipEntryAutoManagedForUser(fixture.userId, {
        novelId: fixture.novelId,
        entryType: "relationship",
        entryId: original.id,
      });
      expect(unlocked.relationships).toEqual([
        {
          ...original,
          enabled: true,
          locked: false,
          selfPronoun: null,
          addresseeTerm: null,
          sentenceParticles: null,
          updatedAt: expect.any(String),
        },
        other,
      ]);
      expect(unlocked.characters).toEqual(map.characters);
      expect(await getRelationshipMapForUser(fixture.userId, fixture.novelId)).toEqual(unlocked);
      const characterUnlocked = await setRelationshipEntryAutoManagedForUser(fixture.userId, {
        novelId: fixture.novelId,
        entryType: "character",
        entryId: map.characters[0]!.id,
      });
      expect(characterUnlocked.characters).toEqual([
        { ...map.characters[0], enabled: true, locked: false, updatedAt: expect.any(String) },
        ...map.characters.slice(1),
      ]);
      expect(characterUnlocked.relationships).toEqual(unlocked.relationships);
      const [after] =
        await sql`SELECT source_revision, translation_generation, active_translation_job_id FROM chapters WHERE id = ${fixture.chapterId}`;
      expect(after).toEqual(before);
      expect(
        await sql`SELECT id FROM workflow_outbox WHERE event_name = 'translation/job.cancelled' AND payload_json::jsonb ->> 'jobId' = ${jobId}`,
      ).toEqual([]);
      const { exportBackupForUser, importBackupForUser } = await import("@/lib/backup.service");
      const backup = await exportBackupForUser(fixture.userId, fixture.novelId);
      expect(backup.novels[0]?.relationshipMap).toEqual(characterUnlocked);
      const restored = await importBackupForUser(fixture.userId, backup);
      expect(await getRelationshipMapForUser(fixture.userId, restored.novelIds[0]!)).toEqual(
        characterUnlocked,
      );
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("rejects owned relationship reads for unsupported language pairs", async () => {
    const fixture = await seedChapter("An unsupported relationship fixture.", "en", "en");
    try {
      await expect(
        getRelationshipWorkspaceForUser(fixture.userId, fixture.novelId),
      ).resolves.toMatchObject({
        novel: { sourceLang: "en", targetLang: "en" },
        map: null,
      });
      await expect(
        getRelationshipMapForUser(fixture.userId, fixture.novelId),
      ).rejects.toMatchObject({
        message: "Relationship maps are not supported for this language pair",
      });
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("replaying a context result is idempotent", async () => {
    const fixture = await seedChapter("儿子对父亲说：我会回来的。", "th");
    const jobId = `job-${randomUUID()}`;
    try {
      await seedRunningAnalysisJob(fixture, jobId);
      await applyRelationshipAnalysis(jobId, 1, 0, relationshipAnalysisFixture());
      const [beforeReplay] = await sql<{ relationshipMap: unknown }[]>`
        SELECT "relationship_map_json"::jsonb AS "relationshipMap"
        FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      const replay = await applyRelationshipAnalysis(jobId, 1, 0, relationshipAnalysisFixture());
      const [afterReplay] = await sql<{ relationshipMap: unknown }[]>`
        SELECT "relationship_map_json"::jsonb AS "relationshipMap"
        FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(replay.applied).toBe(true);
      expect(afterReplay.relationshipMap).toEqual(beforeReplay.relationshipMap);
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("disabling and restoring an automatic entry preserves its management mode", async () => {
    const fixture = await seedChapter("儿子对父亲说：我会回来的。", "th");
    const automaticMap = {
      version: 1 as const,
      characters: [
        {
          id: "father",
          sourceName: "父亲",
          targetName: "พ่อ",
          aliases: [],
          gender: "male" as const,
          role: "father",
          notes: null,
          enabled: true,
          locked: false,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "son",
          sourceName: "儿子",
          targetName: "ลูกชาย",
          aliases: [],
          gender: "male" as const,
          role: "son",
          notes: null,
          enabled: true,
          locked: false,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      relationships: [
        {
          id: "son-to-father",
          speakerId: "son",
          listenerId: "father",
          relationship: "son",
          speakerStatus: "lower" as const,
          familiarity: "close" as const,
          selfPronoun: "ผม",
          addresseeTerm: "พ่อ",
          sentenceParticles: null,
          register: "respectful",
          notes: null,
          enabled: true,
          locked: false,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    try {
      await sql`
        UPDATE "novels"
        SET "relationship_map_json" = ${JSON.stringify(automaticMap)}
        WHERE "id" = ${fixture.novelId}
      `;
      const disabled = await setRelationshipEntryEnabledForUser(fixture.userId, {
        novelId: fixture.novelId,
        entryType: "relationship",
        entryId: "son-to-father",
        enabled: false,
      });
      expect(disabled.relationships[0]).toMatchObject({ enabled: false, locked: false });

      const restored = await setRelationshipEntryEnabledForUser(fixture.userId, {
        novelId: fixture.novelId,
        entryType: "relationship",
        entryId: "son-to-father",
        enabled: true,
      });
      expect(restored.relationships[0]).toMatchObject({ enabled: true, locked: false });
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("returns a safe error for conflicting character aliases", async () => {
    const fixture = await seedChapter("儿子对父亲说：我会回来的。", "th");
    const map = {
      version: 1 as const,
      characters: [
        {
          id: "father",
          sourceName: "父亲",
          targetName: null,
          aliases: [],
          gender: "unknown" as const,
          role: null,
          notes: null,
          enabled: true,
          locked: true,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "son",
          sourceName: "儿子",
          targetName: null,
          aliases: [],
          gender: "unknown" as const,
          role: null,
          notes: null,
          enabled: true,
          locked: true,
          evidence: null,
          lastSeenChapter: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      relationships: [],
    };
    try {
      await sql`
        UPDATE "novels"
        SET "relationship_map_json" = ${JSON.stringify(map)}
        WHERE "id" = ${fixture.novelId}
      `;
      await expect(
        upsertCharacterProfileForUser(fixture.userId, {
          novelId: fixture.novelId,
          id: "son",
          sourceName: "儿子",
          targetName: null,
          aliases: ["父亲"],
          gender: "unknown",
          role: null,
          notes: null,
          evidence: null,
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Relationship map update is invalid:"),
      });
    } finally {
      await deleteFixture(fixture.userId);
    }
  });
  it("rejects stale generation, source revision, or active pointer map writes", async () => {
    const fixture = await seedChapter("儿子对父亲说：我会回来的。", "th");
    const jobId = `job-${randomUUID()}`;
    try {
      await seedRunningAnalysisJob(fixture, jobId);
      await sql`
        UPDATE "chapters"
        SET "source_revision" = 2
        WHERE "id" = ${fixture.chapterId}
      `;
      const result = await applyRelationshipAnalysis(jobId, 1, 0, relationshipAnalysisFixture());
      expect(result.applied).toBe(false);
      const [novel] = await sql<
        { relationshipMap: { characters: unknown[]; relationships: unknown[] } }[]
      >`
        SELECT "relationship_map_json"::jsonb AS "relationshipMap"
        FROM "novels" WHERE "id" = ${fixture.novelId}
      `;
      expect(novel.relationshipMap).toEqual({
        version: 1,
        characters: [],
        relationships: [],
      });
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it.each(["admin", "automatic"] as const)(
    "preserves locked admin facts with %s winning the relationship gate",
    async (winner) => {
      const fixture = await seedChapter("儿子对父亲说：我会回来的。", "th");
      const jobId = `job-${randomUUID()}`;
      const { upsertCharacterRelationshipForUser } = await import("@/lib/relationships/service");
      let gate: Awaited<ReturnType<typeof pauseNextNovelGate>> | undefined;
      let admin: ReturnType<typeof upsertCharacterRelationshipForUser> | undefined;
      let automatic: ReturnType<typeof applyRelationshipAnalysis> | undefined;
      try {
        await seedRunningAnalysisJob(fixture, jobId, 2, 4);
        await applyRelationshipAnalysis(jobId, 2, 0, relationshipAnalysisFixture());
        const initial = await getRelationshipMapForUser(fixture.userId, fixture.novelId);
        const relation = initial.relationships[0]!;
        const [before] =
          await sql`SELECT source_revision, translation_generation, active_translation_job_id FROM chapters WHERE id = ${fixture.chapterId}`;
        const saveAdmin = () =>
          upsertCharacterRelationshipForUser(fixture.userId, {
            novelId: fixture.novelId,
            id: relation.id,
            speakerId: relation.speakerId,
            listenerId: relation.listenerId,
            relationship: "adopted son",
            speakerStatus: "peer",
            familiarity: "distant",
            selfPronoun: "ผม",
            addresseeTerm: "คุณพ่อ",
            sentenceParticles: "ครับ",
            register: "formal",
            notes: "Locked administrator decision",
            evidence: "Administrator evidence",
          });
        const merge = () => applyRelationshipAnalysis(jobId, 2, 0, relationshipAnalysisFixture());
        gate = await pauseNextNovelGate();
        if (winner === "admin") admin = saveAdmin();
        else automatic = merge();
        const blockerPid = await bounded(gate.locked);
        if (winner === "admin") automatic = merge();
        else admin = saveAdmin();
        await waitForNovelWaiter(blockerPid);
        gate.release();
        const [saved, merged] = await bounded(Promise.all([admin!, automatic!]));
        expect(merged.applied).toBe(true);
        const expected = saved.relationships[0]!;
        expect(expected).toMatchObject({
          locked: true,
          relationship: "adopted son",
          notes: "Locked administrator decision",
          selfPronoun: "ผม",
          addresseeTerm: "คุณพ่อ",
          sentenceParticles: "ครับ",
        });
        if (winner === "admin") expect(merged.map?.relationships).toEqual([expected]);
        expect(
          (await getRelationshipMapForUser(fixture.userId, fixture.novelId)).relationships,
        ).toEqual([expected]);
        // A later automatic pass must also preserve the winning admin document verbatim.
        expect((await merge()).map?.relationships).toEqual([expected]);
        const [after] =
          await sql`SELECT source_revision, translation_generation, active_translation_job_id FROM chapters WHERE id = ${fixture.chapterId}`;
        expect(after).toEqual(before);
        const [job] =
          await sql`SELECT status, generation, done_chunks FROM translation_jobs WHERE id = ${jobId}`;
        expect(job).toMatchObject({ status: "running", generation: 2, done_chunks: 0 });
        expect(
          await sql`SELECT id FROM workflow_outbox WHERE event_name = 'translation/job.cancelled'
        AND payload_json::jsonb->>'jobId' = ${jobId}`,
        ).toEqual([]);
      } finally {
        gate?.release();
        await bounded(Promise.allSettled([admin, automatic]));
        gate?.restore();
        await sql`DELETE FROM workflow_outbox WHERE payload_json::jsonb->>'jobId' = ${jobId}`;
        await deleteFixture(fixture.userId);
      }
    },
    30_000,
  );
  it("prefers an older retried job when it is the chapter active pointer", async () => {
    const fixture = await seedChapter();
    const retriedJobId = `job-${randomUUID()}`;
    const newerHistoricalJobId = `job-${randomUUID()}`;
    try {
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks", "created_at", "updated_at"
        ) VALUES
          (
            ${retriedJobId}, ${fixture.chapterId}, 'pending', 1, 2,
            2, 1, now() - interval '2 days', now()
          ),
          (
            ${newerHistoricalJobId}, ${fixture.chapterId}, 'done', 1, 1,
            1, 1, now() - interval '1 day', now() - interval '1 day'
          )
      `;
      await sql`
        UPDATE "chapters"
        SET
          "active_translation_job_id" = ${retriedJobId},
          "translation_generation" = 2,
          "status" = 'queued'
        WHERE "id" = ${fixture.chapterId}
      `;

      const activeDetails = await findOwnedTranslationJob(fixture.userId, {
        chapterId: fixture.chapterId,
      });
      const activeProgress = await findOwnedTranslationJobProgress(fixture.userId, {
        chapterId: fixture.chapterId,
      });
      expect(activeDetails?.job.id).toBe(retriedJobId);
      expect(activeProgress?.id).toBe(retriedJobId);

      await sql`
        UPDATE "chapters"
        SET "active_translation_job_id" = NULL, "status" = 'translated'
        WHERE "id" = ${fixture.chapterId}
      `;
      const latestHistory = await findOwnedTranslationJob(fixture.userId, {
        chapterId: fixture.chapterId,
      });
      expect(latestHistory?.job.id).toBe(newerHistoricalJobId);
    } finally {
      await deleteFixture(fixture.userId);
    }
  });

  it("loads approved glossary terms and previous-chapter tails for the run", async () => {
    const rawContent = `${"甲".repeat(40)}原文尾巴`;
    const translatedContent = `${"ก".repeat(40)}ปลายทาง`;
    const fixture = await seedChapter(rawContent);
    try {
      await sql`
        UPDATE "chapters"
        SET
          "translated_content" = ${translatedContent},
          "summary" = 'Previous summary',
          "status" = 'translated'
        WHERE "id" = ${fixture.chapterId}
      `;
      await sql`
        INSERT INTO "glossary_terms" ("id", "novel_id", "source", "target", "category", "note", "status")
        VALUES
          (${`term-${randomUUID()}`}, ${fixture.novelId}, '甲', 'A', 'character', 'note', 'approved'),
          (${`term-${randomUUID()}`}, ${fixture.novelId}, '乙', 'B', 'other', null, 'pending')
      `;

      const context = await loadTranslationRunContext(
        { id: fixture.novelId, contextTailLength: 20 },
        { number: "2" },
      );

      expect(context.terms).toEqual([
        { source: "甲", target: "A", category: "character", note: "note" },
      ]);
      expect(context.previousChapter).toEqual({
        summary: "Previous summary",
        rawTail: rawContent.slice(-20),
        translatedTail: translatedContent.slice(-20),
      });
    } finally {
      await deleteFixture(fixture.userId);
    }
  });
});
