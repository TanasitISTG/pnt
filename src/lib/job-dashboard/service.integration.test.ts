import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import type { ServerTiming } from "@/lib/server-timing";
import type { JobHistorySearch } from "@/lib/job-dashboard/contracts";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let loadJobHistory: typeof import("./service").loadJobHistory;
let loadJobStats: typeof import("./service").loadJobStats;

function createTiming(metrics: string[]): ServerTiming {
  return {
    async measure<T>(name: string, operation: () => Promise<T>) {
      metrics.push(name);
      return operation();
    },
    flush() {},
  };
}

const defaultSearch: JobHistorySearch = {
  q: "",
  type: "all",
  status: "all",
  sort: "updatedAt",
  dir: "desc",
  page: 1,
  pageSize: 25,
};

function search(overrides: Partial<JobHistorySearch> = {}): JobHistorySearch {
  return { ...defaultSearch, ...overrides };
}

integrationDescribe("job observability PostgreSQL contracts", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({ loadJobHistory, loadJobStats } = await import("./service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("returns every owned job across pages and exact lifetime statistics", async () => {
    const ownerUserId = `user-${randomUUID()}`;
    const otherUserId = `user-${randomUUID()}`;
    const novelId = `novel-${randomUUID()}`;
    const secondaryNovelId = `novel-${randomUUID()}`;
    const otherNovelId = `novel-${randomUUID()}`;
    const chapterIds = Array.from({ length: 26 }, () => `chapter-${randomUUID()}`);
    const translationJobIds = Array.from({ length: 26 }, () => `job-${randomUUID()}`);
    const importJobIds = Array.from({ length: 26 }, () => `import-${randomUUID()}`);
    const otherChapterId = `chapter-${randomUUID()}`;
    const otherJobId = `job-${randomUUID()}`;
    const otherImportJobId = `import-${randomUUID()}`;
    const startedAt = new Date("2025-01-01T00:00:00.000Z");

    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
        VALUES
          (${ownerUserId}, 'Observability Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
          (${otherUserId}, 'Other Owner', ${`${otherUserId}@example.test`}, true, now(), now())
      `;
      await transaction`
        INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang", "created_at", "updated_at")
        VALUES
          (${novelId}, ${ownerUserId}, 'Observed Novel', 'zh', 'en', now(), now()),
          (${secondaryNovelId}, ${ownerUserId}, 'Aardvark Novel', 'zh', 'en', now(), now()),
          (${otherNovelId}, ${otherUserId}, 'Other Novel', 'zh', 'en', now(), now())
      `;

      for (let index = 0; index < chapterIds.length; index += 1) {
        const updatedAt = new Date(startedAt.getTime() + index * 1_000);
        const translationStatus =
          index === 0 || index === 24 ? "error" : index === 25 ? "running" : "done";
        const importStatus =
          index === 0 || index === 24 ? "error" : index === 25 ? "pending" : "done";
        const chapterTitle =
          index === 0 ? "100%_Literal" : index === 1 ? "100AXLiteral" : `Chapter ${index + 1}`;
        const importNovelId = index === 2 ? secondaryNovelId : novelId;
        const scrapeProvider = index === 0 ? "toString" : "direct";

        await transaction`
          INSERT INTO "chapters" (
            "id", "novel_id", "number", "title", "raw_content", "status", "raw_char_count",
            "created_at", "updated_at"
          ) VALUES (
            ${chapterIds[index]}, ${novelId}, ${index + 1}, ${chapterTitle},
            ${`Raw chapter ${index + 1}`}, 'raw', 10, ${updatedAt}, ${updatedAt}
          )
        `;
        await transaction`
          INSERT INTO "translation_jobs" (
            "id", "chapter_id", "status", "total_chunks", "done_chunks", "created_at", "updated_at"
          ) VALUES (
            ${translationJobIds[index]}, ${chapterIds[index]}, ${translationStatus}, 1,
            ${translationStatus === "done" ? 1 : 0}, ${updatedAt}, ${updatedAt}
          )
        `;
        await transaction`
          INSERT INTO "import_jobs" (
            "id", "novel_id", "kind", "status", "base_url", "from_number", "to_number", "next_number",
            "scrape_provider", "created_at", "updated_at"
          ) VALUES (
            ${importJobIds[index]}, ${importNovelId}, 'scrape', ${importStatus}, 'https://example.test/novel',
            1, 1, 1, ${scrapeProvider}, ${updatedAt}, ${updatedAt}
          )
        `;
      }
      await transaction`
        UPDATE "import_jobs"
        SET
          "kind" = 'epub',
          "base_url" = 'epub://observed-fixture',
          "source_file_name" = 'Observed Fixture.epub',
          "to_number" = 3,
          "next_number" = 4,
          "scrape_provider" = 'auto',
          "added" = 2,
          "skipped" = 1
        WHERE "id" = ${importJobIds[1]}
      `;

      await transaction`
        INSERT INTO "translation_job_chunks" (
          "job_id", "chunk_index", "source_text", "text_length", "prompt_tokens",
          "completion_tokens", "latency_ms"
        ) VALUES
          (${translationJobIds[24]}, 0, 'source A', 8, 3, 7, 10),
          (${translationJobIds[25]}, 0, 'source B', 8, 5, 11, 20)
      `;
      await transaction`
        INSERT INTO "chapters" (
          "id", "novel_id", "number", "title", "raw_content", "status", "raw_char_count",
          "created_at", "updated_at"
        ) VALUES (${otherChapterId}, ${otherNovelId}, 1, 'Other Chapter', 'Other raw', 'raw', 9, now(), now())
      `;
      await transaction`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "total_chunks", "done_chunks", "created_at", "updated_at"
        ) VALUES (${otherJobId}, ${otherChapterId}, 'done', 1, 1, now(), now())
      `;
      await transaction`
        INSERT INTO "translation_job_chunks" (
          "job_id", "chunk_index", "source_text", "text_length", "prompt_tokens",
          "completion_tokens", "latency_ms"
        ) VALUES (${otherJobId}, 0, 'other', 5, 1000, 1000, 1000)
      `;
      await transaction`
        INSERT INTO "import_jobs" (
          "id", "novel_id", "kind", "status", "base_url", "from_number", "to_number",
          "next_number", "scrape_provider", "created_at", "updated_at"
        ) VALUES (
          ${otherImportJobId}, ${otherNovelId}, 'scrape', 'done', 'https://example.test/other',
          1, 1, 2, 'direct', now(), now()
        )
      `;
    });

    try {
      const metrics: string[] = [];
      const timing = createTiming(metrics);
      const pageOne = await loadJobHistory(ownerUserId, defaultSearch, timing);
      const pageTwo = await loadJobHistory(ownerUserId, search({ page: 2 }), timing);
      const pageThree = await loadJobHistory(ownerUserId, search({ page: 3 }), timing);
      const allRows = [...pageOne.rows, ...pageTwo.rows, ...pageThree.rows];

      expect(pageOne.rowCount).toBe(52);
      expect(pageOne.rows).toHaveLength(25);
      expect(pageTwo.rows).toHaveLength(25);
      expect(pageThree.rows).toHaveLength(2);
      expect(pageOne.rows.slice(0, 2).map((row) => row.id)).toEqual([
        importJobIds[25],
        translationJobIds[25],
      ]);
      expect(new Set(allRows.map((row) => row.id)).size).toBe(52);
      expect(
        allRows.every((row) => row.novelId === novelId || row.novelId === secondaryNovelId),
      ).toBe(true);
      expect(allRows.some((row) => row.id === translationJobIds[0])).toBe(true);
      expect(allRows.some((row) => row.id === importJobIds[0])).toBe(true);
      expect(allRows.some((row) => row.id === otherJobId)).toBe(false);
      expect(allRows.some((row) => row.id === otherImportJobId)).toBe(false);
      expect(pageThree.page).toBe(3);

      const translationRows = await loadJobHistory(
        ownerUserId,
        search({ type: "translation", pageSize: 50 }),
        timing,
      );
      expect(translationRows.rowCount).toBe(26);
      expect(translationRows.rows.every((row) => row.type === "translation")).toBe(true);

      const scrapeRows = await loadJobHistory(
        ownerUserId,
        search({ type: "scrape", pageSize: 50 }),
        timing,
      );
      expect(scrapeRows.rowCount).toBe(25);
      expect(scrapeRows.rows.every((row) => row.type === "scrape")).toBe(true);

      const epubRows = await loadJobHistory(
        ownerUserId,
        search({ type: "epub", pageSize: 50 }),
        timing,
      );
      expect(epubRows).toMatchObject({
        rowCount: 1,
        rows: [
          {
            id: importJobIds[1],
            type: "epub",
            sourceFileName: "Observed Fixture.epub",
            canRetry: false,
            progress: { completed: 3, total: 3, percent: 100, preparing: false },
          },
        ],
      });

      const failedRows = await loadJobHistory(
        ownerUserId,
        search({ status: "error", pageSize: 50 }),
        timing,
      );
      expect(failedRows.rowCount).toBe(4);
      expect(failedRows.rows.every((row) => row.status === "error")).toBe(true);

      const invalidProviderRows = await loadJobHistory(
        ownerUserId,
        search({ q: importJobIds[0], pageSize: 50 }),
        timing,
      );
      expect(invalidProviderRows.rows).toEqual([
        expect.objectContaining({
          id: importJobIds[0],
          type: "scrape",
          scrapeProvider: null,
          canRetry: false,
        }),
      ]);

      const searchedRows = await loadJobHistory(
        ownerUserId,
        search({ q: translationJobIds[0], pageSize: 50 }),
        timing,
      );
      expect(searchedRows.rowCount).toBe(1);
      expect(searchedRows.rows[0]?.id).toBe(translationJobIds[0]);

      const literalSearchRows = await loadJobHistory(
        ownerUserId,
        search({ q: "100%_", pageSize: 50 }),
        timing,
      );
      expect(literalSearchRows.rows.map((row) => row.id)).toEqual([translationJobIds[0]]);

      const chapterTitleRows = await loadJobHistory(
        ownerUserId,
        search({ q: "Chapter 26", pageSize: 50 }),
        timing,
      );
      expect(chapterTitleRows.rows.map((row) => row.id)).toEqual([translationJobIds[25]]);

      const chapterNumberRows = await loadJobHistory(
        ownerUserId,
        search({ q: "26.00", pageSize: 50 }),
        timing,
      );
      expect(chapterNumberRows.rows.map((row) => row.id)).toEqual([translationJobIds[25]]);

      const sourceFileRows = await loadJobHistory(
        ownerUserId,
        search({ q: "Observed Fixture.epub", pageSize: 50 }),
        timing,
      );
      expect(sourceFileRows.rows.map((row) => row.id)).toEqual([importJobIds[1]]);

      const baseUrlRows = await loadJobHistory(
        ownerUserId,
        search({ q: "example.test/novel", pageSize: 50 }),
        timing,
      );
      expect(baseUrlRows.rowCount).toBe(25);
      expect(baseUrlRows.rows.every((row) => row.type === "scrape")).toBe(true);

      const novelTitleRows = await loadJobHistory(
        ownerUserId,
        search({ q: "Aardvark Novel", pageSize: 50 }),
        timing,
      );
      expect(novelTitleRows.rows.map((row) => row.id)).toEqual([importJobIds[2]]);

      const oldestRows = await loadJobHistory(
        ownerUserId,
        search({ sort: "createdAt", dir: "asc", pageSize: 50 }),
        timing,
      );
      expect(["scrape", "translation"]).toEqual(oldestRows.rows.slice(0, 2).map((row) => row.type));
      expect(
        oldestRows.rows
          .slice(0, 2)
          .map((row) => row.id)
          .every((id) => id === translationJobIds[0] || id === importJobIds[0]),
      ).toBe(true);

      const titleRows = await loadJobHistory(
        ownerUserId,
        search({ sort: "novelTitle", dir: "asc", pageSize: 50 }),
        timing,
      );
      expect(titleRows.rows[0]).toMatchObject({
        id: importJobIds[2],
        novelTitle: "Aardvark Novel",
      });

      const statusRows = await loadJobHistory(
        ownerUserId,
        search({ sort: "status", dir: "asc", pageSize: 50 }),
        timing,
      );
      expect(statusRows.rows.slice(0, 4).every((row) => row.status === "done")).toBe(true);

      const typeRows = await loadJobHistory(
        ownerUserId,
        search({ sort: "type", dir: "asc", pageSize: 50 }),
        timing,
      );
      expect(typeRows.rows[0]?.type).toBe("epub");
      expect(typeRows.rows[1]?.type).toBe("scrape");
      expect(typeRows.rows.at(-1)?.type).toBe("translation");

      const clampedRows = await loadJobHistory(ownerUserId, search({ page: 999 }), timing);
      expect(clampedRows.page).toBe(3);
      expect(clampedRows.rows).toHaveLength(2);

      const stats = await loadJobStats(ownerUserId, timing);
      expect(stats).toEqual({
        avgChunkLatencyMs: 15,
        promptTokens: 8,
        completionTokens: 18,
        activeTranslationJobs: 1,
        failedTranslationJobs: 2,
        activeImportJobs: 1,
        failedImportJobs: 2,
      });
      expect(metrics).toContain("job-history-count");
      expect(metrics).toContain("job-history-rows");
      expect(metrics).toContain("translation-job-stats");
      expect(metrics).toContain("import-job-stats");
      expect(metrics).toContain("chunk-stats");
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${ownerUserId}, ${otherUserId})`;
    }
  }, 30_000);
});
