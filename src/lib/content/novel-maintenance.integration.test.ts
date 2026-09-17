import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { sql as drizzleSql } from "drizzle-orm";
import type * as ChapterOpsService from "@/lib/content/chapter/chapter-ops.service";
import type * as NovelEditService from "@/lib/content/novel/novel-edit.service";
import type * as TranslationMutations from "@/lib/translation/api/mutations";
import type * as BackupService from "@/lib/backup.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let deleteAllNovelTranslationsForUser: typeof ChapterOpsService.deleteAllNovelTranslationsForUser;
let getResidualScriptChaptersForUser: typeof ChapterOpsService.getResidualScriptChaptersForUser;
let deleteAllGlossaryTermsForUser: typeof import("../glossary/service").deleteAllGlossaryTermsForUser;
let rejectAllPendingGlossaryTermsForUser: typeof import("../glossary/service").rejectAllPendingGlossaryTermsForUser;
let updateNovelForUser: typeof NovelEditService.updateNovelForUser;
let deleteNovelForUser: typeof NovelEditService.deleteNovelForUser;
let enqueueTranslationJob: typeof TranslationMutations.enqueueTranslationJob;
let exportBackupForUser: typeof BackupService.exportBackupForUser;
let importBackupForUser: typeof BackupService.importBackupForUser;
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
type PairChangeFixture = {
  userId: string;
  novelId: string;
  chapterId: string;
  relationshipMapJson: string;
};

type PairChangeSnapshot = {
  sourceLang: string;
  targetLang: string;
  relationshipMapJson: string;
  storySummary: string | null;
  chapterStatus: string;
  activeJobId: string | null;
  translatedTitle: string | null;
  translatedContent: string | null;
  chapterSummary: string | null;
  glossaryRows: Array<{ source: string; target: string; status: string }>;
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

async function seedPairChangeFixture(): Promise<PairChangeFixture> {
  const userId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const chapterId = `chapter-${randomUUID()}`;
  const relationshipMapJson = `\n${JSON.stringify(
    {
      version: 1,
      characters: [
        {
          id: "father",
          sourceName: "父亲",
          targetName: "Father",
          aliases: [],
          gender: "male",
          role: "father",
          notes: null,
          enabled: true,
          locked: false,
          evidence: "父亲",
          lastSeenChapter: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      relationships: [],
    },
    null,
    2,
  )}\n`;
  const rawContent = "父亲在黎明时等待。";

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES (${userId}, 'Pair Change Owner', ${`${userId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "story_summary",
      "relationship_map_json", "created_at", "updated_at"
    ) VALUES (
      ${novelId}, ${userId}, 'Pair Change Novel', 'zh', 'en', 'Persistent story summary',
      ${relationshipMapJson}, now(), now()
    )
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "translated_title", "raw_content",
      "translated_content", "status", "summary", "raw_char_count", "translated_at",
      "created_at", "updated_at"
    ) VALUES (
      ${chapterId}, ${novelId}, 1, '黎明', 'Dawn', ${rawContent},
      'Father waits at dawn.', 'translated', 'The father waits.', ${rawContent.length}, now(),
      now(), now()
    )
  `;
  await sql`
    INSERT INTO "glossary_terms" (
      "id", "novel_id", "source", "target", "category", "status"
    ) VALUES (
      ${`term-${randomUUID()}`}, ${novelId}, '父亲', 'Father', 'character', 'approved'
    )
  `;

  return { userId, novelId, chapterId, relationshipMapJson };
}

async function readPairChangeSnapshot(novelId: string): Promise<PairChangeSnapshot> {
  const [row] = await sql<Omit<PairChangeSnapshot, "glossaryRows">[]>`
    SELECT
      n."source_lang" AS "sourceLang",
      n."target_lang" AS "targetLang",
      n."relationship_map_json" AS "relationshipMapJson",
      n."story_summary" AS "storySummary",
      c."status" AS "chapterStatus",
      c."active_translation_job_id" AS "activeJobId",
      c."translated_title" AS "translatedTitle",
      c."translated_content" AS "translatedContent",
      c."summary" AS "chapterSummary"
    FROM "novels" n
    INNER JOIN "chapters" c ON c."novel_id" = n."id"
    WHERE n."id" = ${novelId}
  `;
  if (!row) throw new Error(`Missing pair-change fixture ${novelId}`);
  const glossaryRows = await sql<PairChangeSnapshot["glossaryRows"]>`
    SELECT "source", "target", "status"
    FROM "glossary_terms"
    WHERE "novel_id" = ${novelId}
    ORDER BY "source"
  `;
  return { ...row, glossaryRows };
}

async function deletePairChangeFixture(fixture: PairChangeFixture) {
  await sql`
    DELETE FROM "workflow_outbox"
    WHERE "payload_json"::jsonb ->> 'novelId' = ${fixture.novelId}
  `;
  await sql`DELETE FROM "user" WHERE "id" = ${fixture.userId}`;
}

async function deleteFixture(fixture: MaintenanceFixture) {
  await sql`
    DELETE FROM "workflow_outbox"
    WHERE "payload_json"::jsonb ->> 'jobId' IN (${fixture.doneJobId}, ${fixture.runningJobId})
  `;
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerUserId}, ${fixture.otherUserId})`;
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Novel gate barrier timed out")), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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

async function waitForNovelWaiter(blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await sql`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))
        AND wait_event_type = 'Lock' AND query LIKE '%for update%' AND query LIKE '%novels%'
    `;
    if (rows.length > 0) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Competing mutation never waited on the novel gate");
}

integrationDescribe("novel maintenance PostgreSQL invariants", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    // Server-only modules must load after DATABASE_URL points at the disposable test database.
    ({ deleteAllNovelTranslationsForUser, getResidualScriptChaptersForUser } =
      await import("@/lib/content/chapter/chapter-ops.service"));
    ({ deleteAllGlossaryTermsForUser, rejectAllPendingGlossaryTermsForUser } =
      await import("../glossary/service"));
    ({ updateNovelForUser, deleteNovelForUser } =
      await import("@/lib/content/novel/novel-edit.service"));
    ({ enqueueTranslationJob } = await import("@/lib/translation/api/mutations"));
    ({ exportBackupForUser, importBackupForUser } = await import("@/lib/backup.service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });
  it("restores multiple novels across chapter and glossary batch boundaries without losing legacy content", async () => {
    const fixture = await seedPairChangeFixture();
    try {
      const backup = await exportBackupForUser(fixture.userId, fixture.novelId);
      const source = backup.novels[0]!;
      const chapter = source.chapters[0]!;
      const longText = "x".repeat(12000);
      backup.novels = ["A", "B"].map((label) => ({
        ...source,
        id: `source-${label}`,
        title: label.repeat(500),
        originalTitle: "o".repeat(500),
        author: "a".repeat(200),
        description: "d".repeat(5000),
        customPrompt: "p".repeat(10000),
        storySummary: longText,
        chapters: Array.from({ length: 51 }, (_, index) => ({
          ...chapter,
          id: `chapter-${label}-${index}`,
          number: String(index + 1),
          title: `${label}-${index}-${longText}`,
          translatedTitle: longText,
          rawContent: index === 50 ? "" : `${label}-raw-${index}-${longText}`,
          translatedContent: `${label}-translated-${index}-${longText}`,
          summary: longText,
          status: index === 0 ? "queued" : "translated",
          translatedAt: "2024-02-03T00:00:00.000Z",
          editedAt: "2024-02-04T00:00:00.000Z",
        })),
        glossaryTerms: Array.from({ length: 51 }, (_, index) => ({
          id: `term-${label}-${index}`,
          source: `${label}-${index}-${longText}`,
          target: `${label}-target-${index}-${longText}`,
          category: "other",
          note: longText,
          status: "approved",
          createdAt: backup.exportedAt,
          updatedAt: backup.exportedAt,
        })),
      }));
      const restored = await importBackupForUser(fixture.userId, backup);
      expect(restored.importedNovelCount).toBe(2);
      expect(new Set(restored.novelIds).size).toBe(2);
      for (const [index, novelId] of restored.novelIds.entries()) {
        const original = backup.novels[index]!;
        const [owner] = await sql`SELECT user_id FROM novels WHERE id = ${novelId}`;
        expect(owner.user_id).toBe(fixture.userId);
        const reread = (await exportBackupForUser(fixture.userId, novelId)).novels[0]!;
        expect(reread).toMatchObject({
          title: `${original.title} (imported)`,
          originalTitle: original.originalTitle,
          author: original.author,
          description: original.description,
          customPrompt: original.customPrompt,
          storySummary: longText,
          relationshipMap: original.relationshipMap,
          publishedAt: null,
        });
        expect(
          reread.chapters.map((row) => ({
            number: Number(row.number),
            title: row.title,
            translatedTitle: row.translatedTitle,
            rawContent: row.rawContent,
            translatedContent: row.translatedContent,
            summary: row.summary,
            status: row.status,
            publishedAt: row.publishedAt,
            translatedAt: row.translatedAt,
            editedAt: row.editedAt,
          })),
        ).toEqual(
          original.chapters.map((row, position) => ({
            number: Number(row.number),
            title: row.title,
            translatedTitle: row.translatedTitle,
            rawContent: row.rawContent,
            translatedContent: row.translatedContent,
            summary: row.summary,
            status: position === 0 ? "raw" : "translated",
            publishedAt: null,
            translatedAt: row.translatedAt,
            editedAt: row.editedAt,
          })),
        );
        expect(
          reread.glossaryTerms
            .map(({ source, target, note }) => ({ source, target, note }))
            .sort((a, b) => a.source.localeCompare(b.source)),
        ).toEqual(
          original.glossaryTerms
            .map(({ source, target, note }) => ({ source, target, note }))
            .sort((a, b) => a.source.localeCompare(b.source)),
        );
        expect(
          reread.chapters.every((row) => !original.chapters.some((old) => old.id === row.id)),
        ).toBe(true);
        expect(
          reread.glossaryTerms.every(
            (row) => !original.glossaryTerms.some((old) => old.id === row.id),
          ),
        ).toBe(true);
        expect(
          await sql`SELECT id FROM chapters WHERE novel_id = ${novelId} AND active_translation_job_id IS NOT NULL`,
        ).toEqual([]);
      }
      const roundtrip = await exportBackupForUser(fixture.userId, restored.novelIds[0]!);
      const again = await importBackupForUser(fixture.userId, roundtrip);
      expect((await exportBackupForUser(fixture.userId, again.novelIds[0]!)).novels[0]?.title).toBe(
        `${backup.novels[0]!.title} (imported) (imported)`,
      );
      await expect(importBackupForUser(fixture.userId, { ...backup, novels: [] })).resolves.toEqual(
        { importedNovelCount: 0, novelIds: [] },
      );
    } finally {
      await deletePairChangeFixture(fixture);
    }
  });

  it("rolls back all novels and earlier batches when a later chapter batch fails", async () => {
    const fixture = await seedPairChangeFixture();
    try {
      const backup = await exportBackupForUser(fixture.userId, fixture.novelId);
      const source = backup.novels[0]!;
      backup.novels = [
        source,
        {
          ...source,
          chapters: Array.from({ length: 51 }, (_, index) => ({
            ...source.chapters[0]!,
            id: `restore-${index}`,
            number: String(index + 1),
            // Valid V1 backup integer, but intentionally exceeds PostgreSQL int4 in batch two.
            rawCharCount: index === 50 ? 2_147_483_648 : 1,
          })),
        },
      ];
      const before = await exportBackupForUser(fixture.userId);
      await expect(importBackupForUser(fixture.userId, backup)).rejects.toThrow();
      const after = await exportBackupForUser(fixture.userId);
      expect(after.novels).toEqual(before.novels);
    } finally {
      await deletePairChangeFixture(fixture);
    }
  });

  it("commits cancellation intents before novel cascade and tolerates eager dispatch failure", async () => {
    const fixture = await seedMaintenanceFixture();
    const dispatched: string[] = [];
    try {
      expect(
        await deleteNovelForUser(fixture.otherUserId, fixture.novelId, skipEagerDispatch),
      ).toEqual({ success: true });
      expect((await readNovelSnapshot(fixture.novelId)).jobs).toHaveLength(2);
      const result = await deleteNovelForUser(fixture.ownerUserId, fixture.novelId, async (id) => {
        dispatched.push(id);
        expect(await sql`SELECT id FROM novels WHERE id = ${fixture.novelId}`).toHaveLength(0);
        expect(await sql`SELECT id FROM chapters WHERE novel_id = ${fixture.novelId}`).toHaveLength(
          0,
        );
        expect(
          await sql`SELECT id FROM translation_jobs WHERE id IN (${fixture.runningJobId}, ${fixture.doneJobId})`,
        ).toHaveLength(0);
        const [event] =
          await sql`SELECT event_name, payload_json, status FROM workflow_outbox WHERE id = ${id}`;
        expect(event.event_name).toBe("translation/job.cancelled");
        expect(JSON.parse(event.payload_json)).toEqual({
          jobId: fixture.runningJobId,
          generation: 4,
        });
        expect(event.status).toBe("pending");
        throw new Error("eager delivery unavailable");
      });
      expect(result).toEqual({ success: true });
      expect(dispatched).toHaveLength(1);
      expect(
        await deleteNovelForUser(fixture.ownerUserId, fixture.novelId, async (id) => {
          dispatched.push(id);
        }),
      ).toEqual({ success: true });
      expect(dispatched).toHaveLength(1);
      expect(await sql`SELECT id FROM novels WHERE id = ${fixture.otherNovelId}`).toHaveLength(1);
    } finally {
      await sql`DELETE FROM workflow_outbox WHERE payload_json::jsonb ->> 'jobId' IN (${fixture.runningJobId}, ${fixture.doneJobId})`;
      await sql`DELETE FROM "user" WHERE id IN (${fixture.ownerUserId}, ${fixture.otherUserId})`;
    }
  });
  it("preserves same-pair maps and atomically guards and resets changed pairs", async () => {
    const fixture = await seedPairChangeFixture();
    try {
      await updateNovelForUser(fixture.userId, {
        novelId: fixture.novelId,
        title: "Renamed Pair Change Novel",
      });
      expect((await readPairChangeSnapshot(fixture.novelId)).relationshipMapJson).toBe(
        fixture.relationshipMapJson,
      );

      await updateNovelForUser(fixture.userId, {
        novelId: fixture.novelId,
        sourceLang: "zh",
        targetLang: "en",
      });
      expect((await readPairChangeSnapshot(fixture.novelId)).relationshipMapJson).toBe(
        fixture.relationshipMapJson,
      );

      const jobId = `job-${randomUUID()}`;
      await sql`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks"
        ) VALUES (${jobId}, ${fixture.chapterId}, 'pending', 1, 1, 1, 0)
      `;
      await sql`
        UPDATE "chapters"
        SET "status" = 'queued', "active_translation_job_id" = ${jobId},
            "translation_generation" = 1
        WHERE "id" = ${fixture.chapterId}
      `;

      await expect(
        updateNovelForUser(fixture.userId, {
          novelId: fixture.novelId,
          sourceLang: "en",
          targetLang: "th",
        }),
      ).rejects.toThrow("Cancel active translations before changing the language pair");
      const guarded = await readPairChangeSnapshot(fixture.novelId);
      expect(guarded).toMatchObject({
        sourceLang: "zh",
        targetLang: "en",
        relationshipMapJson: fixture.relationshipMapJson,
        chapterStatus: "queued",
        activeJobId: jobId,
      });

      await sql`
        UPDATE "translation_jobs"
        SET "status" = 'cancelled'
        WHERE "id" = ${jobId}
      `;
      await sql`
        UPDATE "chapters"
        SET "status" = 'translated', "active_translation_job_id" = NULL
        WHERE "id" = ${fixture.chapterId}
      `;
      const beforeReset = await readPairChangeSnapshot(fixture.novelId);

      await updateNovelForUser(fixture.userId, {
        novelId: fixture.novelId,
        sourceLang: "en",
        targetLang: "th",
      });

      expect(await readPairChangeSnapshot(fixture.novelId)).toEqual({
        ...beforeReset,
        sourceLang: "en",
        targetLang: "th",
        relationshipMapJson: '{"version":1,"characters":[],"relationships":[]}',
      });
    } finally {
      await deletePairChangeFixture(fixture);
    }
  }, 30_000);

  it("serializes language changes with concurrent translation enqueue", async () => {
    const fixture = await seedPairChangeFixture();
    try {
      const [pairChange, enqueue] = await Promise.allSettled([
        updateNovelForUser(fixture.userId, {
          novelId: fixture.novelId,
          sourceLang: "en",
          targetLang: "th",
        }),
        enqueueTranslationJob(
          fixture.userId,
          fixture.chapterId,
          { model: "integration-model" } as never,
          "overwrite",
          skipEagerDispatch,
        ),
      ]);

      expect(enqueue.status).toBe("fulfilled");
      const snapshot = await readPairChangeSnapshot(fixture.novelId);
      expect(snapshot.activeJobId).not.toBeNull();
      if (pairChange.status === "fulfilled") {
        expect(snapshot).toMatchObject({
          sourceLang: "en",
          targetLang: "th",
          relationshipMapJson: '{"version":1,"characters":[],"relationships":[]}',
        });
      } else {
        expect(pairChange.reason).toMatchObject({
          message: "Cancel active translations before changing the language pair",
        });
        expect(snapshot).toMatchObject({
          sourceLang: "zh",
          targetLang: "en",
          relationshipMapJson: fixture.relationshipMapJson,
        });
      }
    } finally {
      await deletePairChangeFixture(fixture);
    }
  }, 30_000);

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
        FROM "workflow_outbox"
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
        FROM "workflow_outbox"
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
  it("reports residual scripts across keyset pages with ownership and exemptions", async () => {
    const ownerUserId = `user-${randomUUID()}`;
    const otherUserId = `user-${randomUUID()}`;
    const novelId = `novel-${randomUUID()}`;
    const chapterPrefix = `report-chapter-${randomUUID()}-`;
    const approvedTermId = `term-${randomUUID()}`;
    const pendingTermId = `term-${randomUUID()}`;

    await sql`
      INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
      VALUES
        (${ownerUserId}, 'Residual Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
        (${otherUserId}, 'Residual Other', ${`${otherUserId}@example.test`}, true, now(), now())
    `;
    try {
      await sql`
        INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang")
        VALUES (${novelId}, ${ownerUserId}, 'Residual Report Novel', 'zh', 'th')
      `;
      await sql`
        INSERT INTO "glossary_terms" (
          "id", "novel_id", "source", "target", "category", "status"
        ) VALUES
          (${approvedTermId}, ${novelId}, '术语', 'OpenAI', 'other', 'approved'),
          (${pendingTermId}, ${novelId}, '待定', 'PendingLatin', 'other', 'pending')
      `;
      await sql`
        INSERT INTO "chapters" (
          "id", "novel_id", "number", "title", "raw_content", "translated_content",
          "status", "raw_char_count"
        )
        SELECT
          ${chapterPrefix} || lpad(generated.series::text, 3, '0'),
          ${novelId},
          generated.series + 1,
          'Report chapter ' || generated.series,
          CASE generated.series
            WHEN 1 THEN '<em>原文</em>'
            WHEN 2 THEN '术语'
            WHEN 101 THEN '待定'
            ELSE '原文'
          END,
          CASE generated.series
            WHEN 0 THEN 'ภาษาไทย Hello'
            WHEN 1 THEN '<em>ภาษาไทย</em>'
            WHEN 2 THEN 'OpenAI ภาษาไทย'
            WHEN 100 THEN 'ภาษาไทย мир مرحبا'
            WHEN 101 THEN 'ภาษาไทย PendingLatin'
            ELSE 'ภาษาไทย'
          END,
          'translated'::chapter_status,
          20
        FROM generate_series(0, 104) AS generated(series)
      `;

      await expect(getResidualScriptChaptersForUser(otherUserId, novelId)).rejects.toThrow(
        "Novel not found or unauthorized",
      );

      const results = await getResidualScriptChaptersForUser(ownerUserId, novelId);
      expect(
        results.map((result) => ({
          chapterId: result.chapterId,
          number: Number(result.number),
          count: result.count,
        })),
      ).toEqual([
        { chapterId: `${chapterPrefix}000`, number: 1, count: 5 },
        { chapterId: `${chapterPrefix}100`, number: 101, count: 8 },
        { chapterId: `${chapterPrefix}101`, number: 102, count: 12 },
      ]);
      expect(Object.keys(results[0]).toSorted()).toEqual(["chapterId", "count", "number"]);
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${ownerUserId}, ${otherUserId})`;
    }
  }, 30_000);

  it.each(["enqueue", "retry"] as const)(
    "rereads the replacement generation when novel deletion waits for %s",
    async (operation) => {
      const fixture = await seedMaintenanceFixture();
      // Service imports must wait until beforeAll redirects DATABASE_URL to the disposable DB.
      const mutations = await import("@/lib/translation/api/mutations");
      const jobIds = [fixture.runningJobId];
      const deletionDispatches: string[] = [];
      let gate: Awaited<ReturnType<typeof pauseNextNovelGate>> | undefined;
      let replacement: Promise<{ jobId: string }> | undefined;
      let deletion: Promise<{ success: true }> | undefined;
      try {
        if (operation === "retry") {
          await sql`UPDATE translation_jobs SET overwrite_existing = true WHERE id = ${fixture.runningJobId}`;
          await mutations.cancelTranslationRunsForUser(fixture.ownerUserId, {
            jobIds: [fixture.runningJobId],
          });
        }
        gate = await pauseNextNovelGate();
        replacement = (
          operation === "enqueue"
            ? mutations.enqueueTranslationJob(
                fixture.ownerUserId,
                fixture.runningChapterId,
                { model: "integration-model" } as never,
                "overwrite",
                skipEagerDispatch,
              )
            : mutations.retryTranslationJobForUser(
                fixture.ownerUserId,
                fixture.runningJobId,
                skipEagerDispatch,
              )
        ).then((result) => {
          if (!jobIds.includes(result.jobId)) jobIds.push(result.jobId);
          return result;
        });
        const blockerPid = await bounded(gate.locked);
        deletion = deleteNovelForUser(fixture.ownerUserId, fixture.novelId, async (id) => {
          deletionDispatches.push(id);
        });
        await waitForNovelWaiter(blockerPid);
        gate.release();
        const [replaced, deleted] = await bounded(Promise.all([replacement, deletion]));
        expect(deleted).toEqual({ success: true });
        if (operation === "retry") expect(replaced.jobId).toBe(fixture.runningJobId);
        else expect(replaced.jobId).not.toBe(fixture.runningJobId);
        const events = await sql<
          Array<{ id: string; status: string; payload: { jobId: string; generation: number } }>
        >`
        SELECT id, status, payload_json::jsonb AS payload FROM workflow_outbox
        WHERE event_name = 'translation/job.cancelled' AND payload_json::jsonb->>'jobId' IN ${sql(jobIds)}
        ORDER BY (payload_json::jsonb->>'generation')::integer
      `;
        expect(events.map(({ status, payload }) => ({ status, payload }))).toEqual([
          { status: "pending", payload: { jobId: fixture.runningJobId, generation: 4 } },
          { status: "pending", payload: { jobId: replaced.jobId, generation: 5 } },
        ]);
        expect(deletionDispatches).toEqual([events[1].id]);
        expect(await sql`SELECT id FROM chapters WHERE id = ${fixture.runningChapterId}`).toEqual(
          [],
        );
        expect(await sql`SELECT id FROM translation_jobs WHERE id IN ${sql(jobIds)}`).toEqual([]);
        expect(await sql`SELECT id FROM novels WHERE id = ${fixture.novelId}`).toEqual([]);
        const [request] = await sql`SELECT payload_json::jsonb AS payload FROM workflow_outbox
        WHERE event_name = 'translation/job.requested' AND payload_json::jsonb->>'jobId' = ${replaced.jobId}`;
        expect(request.payload).toMatchObject({ jobId: replaced.jobId, generation: 5 });
      } finally {
        gate?.release();
        await bounded(Promise.allSettled([replacement, deletion]));
        gate?.restore();
        await sql`DELETE FROM workflow_outbox WHERE payload_json::jsonb->>'jobId' IN ${sql(jobIds)}`;
        await deleteFixture(fixture);
      }
    },
    30_000,
  );
});
