import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { sql as drizzleSql } from "drizzle-orm";
import type {
  reorderChaptersForUser as ReorderChaptersForUser,
  updateChapterForUser as UpdateChapterForUser,
} from "@/lib/content/chapter/chapter-edit.service";
import type { deleteChapterForUser as DeleteChapterForUser } from "@/lib/content/chapter/chapter-delete.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let updateChapterForUser: typeof UpdateChapterForUser;
let reorderChaptersForUser: typeof ReorderChaptersForUser;
let deleteChapterForUser: typeof DeleteChapterForUser;
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
  translationGeneration: number;
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
      "translation_generation" AS "translationGeneration",
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
    DELETE FROM "workflow_outbox"
    WHERE "payload_json"::jsonb ->> 'jobId' = ${fixture.runningJobId}
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

integrationDescribe("chapter edit PostgreSQL invariants", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    // Load server-only database code after the test database override is set.
    ({ updateChapterForUser, reorderChaptersForUser } =
      await import("@/lib/content/chapter/chapter-edit.service"));
    ({ deleteChapterForUser } = await import("@/lib/content/chapter/chapter-delete.service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it.each([
    "unchanged",
    "source",
    "manual title",
    "completed generation",
    "translation deletion",
    "chapter deletion",
  ])(
    "guards a delayed generated title against %s",
    async (change) => {
      const fixture = await seedChapterFixture();
      // Load only after beforeAll redirects database imports to the disposable test database.
      const titleModule = await import("@/lib/translation/workflow/title");
      const providerModule = await import("@/lib/translation/providers/provider-client");
      // This service also imports db; defer it until the disposable database override.
      const { translateMissingTitlesForUser, deleteAllNovelTranslationsForUser } =
        await import("@/lib/content/chapter/chapter-ops.service");
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const providerSpy = vi
        .spyOn(providerModule, "createProviderClient")
        .mockResolvedValue({} as never);
      const titleSpy = vi
        .spyOn(titleModule, "translateChapterTitle")
        .mockImplementation(async () => {
          entered();
          await barrier;
          return { translated: "Generated title", promptTokens: 0, completionTokens: 0 };
        });
      let pending: Promise<{ translated: number }> | undefined;
      try {
        await sql`UPDATE "chapters" SET "translated_title" = NULL WHERE "id" = ${fixture.chapterIds[0]}`;
        pending = translateMissingTitlesForUser(fixture.ownerUserId, fixture.novelId);
        await started;
        if (change === "source") {
          await updateChapterForUser(
            fixture.ownerUserId,
            {
              chapterId: fixture.chapterIds[0],
              rawContent: "New source",
              sourceChangePolicy: "keep",
            },
            skipEagerDispatch,
          );
        } else if (change === "manual title") {
          await updateChapterForUser(
            fixture.ownerUserId,
            {
              chapterId: fixture.chapterIds[0],
              translatedTitle: "Manual title",
            },
            skipEagerDispatch,
          );
        } else if (change === "completed generation") {
          await sql`UPDATE "chapters" SET "translation_generation" = "translation_generation" + 1
            WHERE "id" = ${fixture.chapterIds[0]}`;
        } else if (change === "translation deletion") {
          await deleteAllNovelTranslationsForUser(
            fixture.ownerUserId,
            fixture.novelId,
            skipEagerDispatch,
          );
        } else if (change === "chapter deletion") {
          await deleteChapterForUser(fixture.ownerUserId, fixture.chapterIds[0], skipEagerDispatch);
        }
        const newerState = await readChapters(fixture.novelId);
        release();
        expect(await pending).toEqual({ translated: change === "unchanged" ? 1 : 0 });
        if (change === "unchanged") {
          expect((await readChapters(fixture.novelId))[0].translatedTitle).toBe("Generated title");
        } else {
          expect(await readChapters(fixture.novelId)).toEqual(newerState);
        }
      } finally {
        release();
        await pending?.catch(() => {});
        titleSpy.mockRestore();
        providerSpy.mockRestore();
        await deleteFixture(fixture);
      }
    },
    30_000,
  );

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
        FROM "workflow_outbox"
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
  it("cancels the exact active generation before deleting a chapter", async () => {
    const fixture = await seedChapterFixture(true);
    const dispatchedOutboxIds: string[] = [];
    try {
      await sql`INSERT INTO "reader_progress" ("user_id", "novel_id", "last_chapter_id", "scroll_fraction")
        VALUES (${fixture.ownerUserId}, ${fixture.novelId}, ${fixture.chapterIds[0]}, 0.75),
          (${fixture.otherUserId}, ${fixture.novelId}, ${fixture.chapterIds[2]}, 0.4)`;
      await expect(
        deleteChapterForUser(fixture.otherUserId, fixture.chapterIds[0], async () => {}),
      ).rejects.toThrow("Chapter not found or unauthorized");

      await expect(
        deleteChapterForUser(fixture.ownerUserId, fixture.chapterIds[0], async (outboxId) => {
          dispatchedOutboxIds.push(outboxId);
        }),
      ).resolves.toEqual({ success: true });

      const [chapterRows, jobRows, outboxRows] = await Promise.all([
        sql`SELECT "id" FROM "chapters" WHERE "id" = ${fixture.chapterIds[0]}`,
        sql`SELECT "id" FROM "translation_jobs" WHERE "id" = ${fixture.runningJobId}`,
        sql<
          Array<{ id: string; eventName: string; payload: { jobId: string; generation: number } }>
        >`
          SELECT
            "id",
            "event_name" AS "eventName",
            "payload_json"::jsonb AS "payload"
          FROM "workflow_outbox"
          WHERE "payload_json"::jsonb ->> 'jobId' = ${fixture.runningJobId}
        `,
      ]);

      expect(chapterRows).toHaveLength(0);
      expect(jobRows).toHaveLength(0);
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]).toMatchObject({
        eventName: "translation/job.cancelled",
        payload: { jobId: fixture.runningJobId, generation: 2 },
      });
      expect(dispatchedOutboxIds).toEqual([outboxRows[0].id]);
      const positions =
        await sql`SELECT "user_id", "last_chapter_id", "scroll_fraction" FROM "reader_progress"
        WHERE "novel_id" = ${fixture.novelId}`;
      expect(positions.find((row) => row.user_id === fixture.ownerUserId)).toMatchObject({
        last_chapter_id: null,
        scroll_fraction: 0,
      });
      expect(positions.find((row) => row.user_id === fixture.otherUserId)).toMatchObject({
        last_chapter_id: fixture.chapterIds[2],
        scroll_fraction: 0.4,
      });
    } finally {
      await deleteFixture(fixture);
    }
  });
  it("keeps a committed cancellation intent when eager dispatch fails", async () => {
    const fixture = await seedChapterFixture(true);
    try {
      await expect(
        deleteChapterForUser(fixture.ownerUserId, fixture.chapterIds[0], async () => {
          throw new Error("Inngest unavailable");
        }),
      ).resolves.toEqual({ success: true });

      const [chapterRows, jobRows, outboxRows] = await Promise.all([
        sql`SELECT "id" FROM "chapters" WHERE "id" = ${fixture.chapterIds[0]}`,
        sql`SELECT "id" FROM "translation_jobs" WHERE "id" = ${fixture.runningJobId}`,
        sql<
          Array<{
            status: string;
            attempts: number;
            lastError: string | null;
            payload: { jobId: string; generation: number };
          }>
        >`
          SELECT
            "status",
            "attempts",
            "last_error" AS "lastError",
            "payload_json"::jsonb AS "payload"
          FROM "workflow_outbox"
          WHERE "payload_json"::jsonb ->> 'jobId' = ${fixture.runningJobId}
        `,
      ]);

      expect(chapterRows).toHaveLength(0);
      expect(jobRows).toHaveLength(0);
      expect(outboxRows).toEqual([
        {
          status: "pending",
          attempts: 0,
          lastError: null,
          payload: { jobId: fixture.runningJobId, generation: 2 },
        },
      ]);
    } finally {
      await deleteFixture(fixture);
    }
  });

  it("serializes deletion with a concurrent active-job pointer change", async () => {
    const fixture = await seedChapterFixture(true);
    const dispatchedOutboxIds: string[] = [];
    // The database module must load after the disposable URL override in beforeAll.
    const locks = await import("@/lib/db/novel-lock");
    const realLock = locks.lockNovelForMutation;
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    const lockSpy = vi.spyOn(locks, "lockNovelForMutation").mockImplementation(async (...args) => {
      const pause = first;
      first = false;
      const result = await realLock(...args);
      if (pause) {
        acquired();
        await barrier;
      }
      return result;
    });
    let edit: Promise<unknown> | undefined;
    let deletion: Promise<unknown> | undefined;
    try {
      edit = updateChapterForUser(
        fixture.ownerUserId,
        {
          chapterId: fixture.chapterIds[0],
          rawContent: "Changed while deleting",
          sourceChangePolicy: "clear",
        },
        async (id) => {
          dispatchedOutboxIds.push(id);
        },
      );
      await locked;
      deletion = deleteChapterForUser(fixture.ownerUserId, fixture.chapterIds[0], async (id) => {
        dispatchedOutboxIds.push(id);
      });
      const deadline = Date.now() + 10_000;
      let waiting = false;
      while (Date.now() < deadline) {
        const rows = await sql`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%novels%' AND pid <> pg_backend_pid()`;
        if (rows.length > 0) {
          waiting = true;
          break;
        }
      }
      expect(waiting).toBe(true);
      release();
      await edit;
      await expect(deletion).resolves.toEqual({ success: true });

      const [chapterRows, activeJobRows, outboxRows] = await Promise.all([
        sql`SELECT "id", "active_translation_job_id" AS "activeJobId" FROM "chapters" WHERE "id" = ${fixture.chapterIds[0]}`,
        sql`
          SELECT "id", "status", "generation"
          FROM "translation_jobs"
          WHERE "id" = ${fixture.runningJobId}
            AND "status" IN ('pending', 'running')
        `,
        sql<Array<{ status: string; payload: { jobId: string; generation: number } }>>`
          SELECT "status", "payload_json"::jsonb AS "payload"
          FROM "workflow_outbox"
          WHERE "payload_json"::jsonb ->> 'jobId' = ${fixture.runningJobId}
        `,
      ]);

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]).toMatchObject({
        status: "pending",
        payload: { jobId: fixture.runningJobId, generation: 2 },
      });
      expect(activeJobRows).toHaveLength(0);
      expect(dispatchedOutboxIds).toHaveLength(1);

      expect(await deletion).toEqual({ success: true });
      expect(chapterRows).toHaveLength(0);
    } finally {
      release();
      await Promise.allSettled([edit, deletion]);
      lockSpy.mockRestore();
      await deleteFixture(fixture);
    }
  }, 30_000);

  it.each(["enqueue", "retry"] as const)(
    "rereads the replacement generation when chapter deletion waits for %s",
    async (operation) => {
      const fixture = await seedChapterFixture(true);
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
                fixture.chapterIds[0],
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
        deletion = deleteChapterForUser(fixture.ownerUserId, fixture.chapterIds[0], async (id) => {
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
          { status: "pending", payload: { jobId: fixture.runningJobId, generation: 2 } },
          { status: "pending", payload: { jobId: replaced.jobId, generation: 3 } },
        ]);
        expect(deletionDispatches).toEqual([events[1].id]);
        expect(await sql`SELECT id FROM chapters WHERE id = ${fixture.chapterIds[0]}`).toEqual([]);
        expect(await sql`SELECT id FROM translation_jobs WHERE id IN ${sql(jobIds)}`).toEqual([]);

        const [request] = await sql`SELECT payload_json::jsonb AS payload FROM workflow_outbox
        WHERE event_name = 'translation/job.requested' AND payload_json::jsonb->>'jobId' = ${replaced.jobId}`;
        expect(request.payload).toMatchObject({ jobId: replaced.jobId, generation: 3 });
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

  it.each(["enqueue", "reorder"] as const)(
    "serializes reorder against enqueue with %s winning the novel gate",
    async (winner) => {
      const fixture = await seedChapterFixture();
      const { enqueueTranslationJob } = await import("@/lib/translation/api/mutations");
      const gate = await pauseNextNovelGate();
      const jobIds: string[] = [];
      let queued: ReturnType<typeof enqueueTranslationJob> | undefined;
      let reordered: Promise<PromiseSettledResult<{ reordered: number }>> | undefined;
      try {
        const before = await readChapters(fixture.novelId);
        const enqueue = () =>
          enqueueTranslationJob(
            fixture.ownerUserId,
            fixture.chapterIds[0],
            { model: "integration-model" } as never,
            "overwrite",
            skipEagerDispatch,
          ).then((result) => {
            jobIds.push(result.jobId);
            return result;
          });
        // Observe rejection immediately so the expected losing reorder is never unhandled.
        const reorder = () =>
          Promise.allSettled([
            reorderChaptersForUser(fixture.ownerUserId, {
              novelId: fixture.novelId,
              chapterIds: [fixture.chapterIds[2], fixture.chapterIds[0], fixture.chapterIds[1]],
            }),
          ]).then(([result]) => result);
        if (winner === "enqueue") queued = enqueue();
        else reordered = reorder();
        const blockerPid = await bounded(gate.locked);
        if (winner === "enqueue") reordered = reorder();
        else queued = enqueue();
        await waitForNovelWaiter(blockerPid);
        gate.release();
        const [job, order] = await bounded(Promise.all([queued!, reordered!]));
        const after = await readChapters(fixture.novelId);
        if (winner === "enqueue") {
          expect(order).toMatchObject({
            status: "rejected",
            reason: {
              message: "Chapter order cannot change while translation is active",
            },
          });
          expect(
            after.map(({ id, number, sourceRevision }) => ({ id, number, sourceRevision })),
          ).toEqual(
            before.map(({ id, number, sourceRevision }) => ({ id, number, sourceRevision })),
          );
        } else {
          expect(order).toEqual({ status: "fulfilled", value: { reordered: 3 } });
          expect(
            after.map(({ id, number, sourceRevision }) => ({ id, number, sourceRevision })),
          ).toEqual([
            { id: fixture.chapterIds[2], number: "1.00", sourceRevision: 10 },
            { id: fixture.chapterIds[0], number: "1.50", sourceRevision: 5 },
            { id: fixture.chapterIds[1], number: "3.00", sourceRevision: 8 },
          ]);
        }
        const [persisted] =
          await sql`SELECT source_revision, generation, status FROM translation_jobs WHERE id = ${job.jobId}`;
        expect(persisted).toMatchObject({
          source_revision: winner === "reorder" ? 5 : 4,
          generation: 3,
          status: "pending",
        });
        expect(after.find((row) => row.id === fixture.chapterIds[0])?.activeJobId).toBe(job.jobId);
        expect(
          await sql`SELECT id FROM workflow_outbox WHERE event_name = 'translation/job.cancelled'
        AND payload_json::jsonb->>'jobId' IN ${sql(jobIds)}`,
        ).toEqual([]);
      } finally {
        gate.release();
        await bounded(Promise.allSettled([queued, reordered]));
        gate.restore();
        if (jobIds.length)
          await sql`DELETE FROM workflow_outbox WHERE payload_json::jsonb->>'jobId' IN ${sql(jobIds)}`;
        await deleteFixture(fixture);
      }
    },
    30_000,
  );

  it("rejects a stale reorder after a gated chapter insertion changes membership", async () => {
    const fixture = await seedChapterFixture();
    // Use the existing import commit service as the equivalent gated insertion boundary.
    const { commitScrapeImportChapter } = await import("@/lib/import/job-store");
    const importJobId = `import-${randomUUID()}`;
    const gate = await pauseNextNovelGate();
    let insertion: ReturnType<typeof commitScrapeImportChapter> | undefined;
    let reorder: Promise<PromiseSettledResult<{ reordered: number }>[]> | undefined;
    try {
      const before = await readChapters(fixture.novelId);
      await sql`INSERT INTO import_jobs (id, novel_id, status, base_url, from_number, to_number, next_number)
        VALUES (${importJobId}, ${fixture.novelId}, 'running', 'https://example.test/book', 2, 2, 2)`;
      insertion = commitScrapeImportChapter(importJobId, 2, {
        kind: "added",
        number: "2",
        title: "Inserted chapter",
        content: "New source",
      });
      const blockerPid = await bounded(gate.locked);
      reorder = Promise.allSettled([
        reorderChaptersForUser(fixture.ownerUserId, {
          novelId: fixture.novelId,
          chapterIds: [fixture.chapterIds[2], fixture.chapterIds[0], fixture.chapterIds[1]],
        }),
      ]);
      await waitForNovelWaiter(blockerPid);
      gate.release();
      const [inserted, outcomes] = await bounded(Promise.all([insertion, reorder]));
      expect(inserted).toEqual({ stop: false, created: true });
      expect(outcomes).toEqual([
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: "Chapter order is stale; refresh and try again",
          }),
        },
      ]);
      const after = await readChapters(fixture.novelId);
      expect(after.filter((row) => fixture.chapterIds.includes(row.id))).toEqual(before);
      expect(after.filter((row) => !fixture.chapterIds.includes(row.id))).toEqual([
        expect.objectContaining({
          number: "2.00",
          rawContent: "New source",
          sourceRevision: 1,
          activeJobId: null,
        }),
      ]);
      const [importJob] =
        await sql`SELECT added, next_number FROM import_jobs WHERE id = ${importJobId}`;
      expect(importJob).toEqual({ added: 1, next_number: 3 });
    } finally {
      gate.release();
      await bounded(Promise.allSettled([insertion, reorder]));
      gate.restore();
      await deleteFixture(fixture);
    }
  }, 30_000);
});
