import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import type { ServerTiming } from "@/lib/server-timing";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let loadJobActivity: typeof import("./job-observability.service").loadJobActivity;
let loadJobStats: typeof import("./job-observability.service").loadJobStats;

function createTiming(metrics: string[]): ServerTiming {
  return {
    async measure<T>(name: string, operation: () => Promise<T>) {
      metrics.push(name);
      return operation();
    },
    flush() {},
  };
}

integrationDescribe("job observability PostgreSQL contracts", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({ loadJobActivity, loadJobStats } = await import("./job-observability.service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("returns owned latest-25 activity and exact lifetime statistics", async () => {
    const ownerUserId = `user-${randomUUID()}`;
    const otherUserId = `user-${randomUUID()}`;
    const novelId = `novel-${randomUUID()}`;
    const otherNovelId = `novel-${randomUUID()}`;
    const chapterIds = Array.from({ length: 26 }, () => `chapter-${randomUUID()}`);
    const translationJobIds = Array.from({ length: 26 }, () => `job-${randomUUID()}`);
    const importJobIds = Array.from({ length: 26 }, () => `import-${randomUUID()}`);
    const otherChapterId = `chapter-${randomUUID()}`;
    const otherJobId = `job-${randomUUID()}`;
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
          (${otherNovelId}, ${otherUserId}, 'Other Novel', 'zh', 'en', now(), now())
      `;

      for (let index = 0; index < chapterIds.length; index += 1) {
        const updatedAt = new Date(startedAt.getTime() + index * 1_000);
        const translationStatus =
          index === 0 || index === 24 ? "error" : index === 25 ? "running" : "done";
        const importStatus =
          index === 0 || index === 24 ? "error" : index === 25 ? "pending" : "done";

        await transaction`
          INSERT INTO "chapters" (
            "id", "novel_id", "number", "title", "raw_content", "status", "raw_char_count",
            "created_at", "updated_at"
          ) VALUES (
            ${chapterIds[index]}, ${novelId}, ${index + 1}, ${`Chapter ${index + 1}`},
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
            "id", "novel_id", "status", "base_url", "from_number", "to_number", "next_number",
            "created_at", "updated_at"
          ) VALUES (
            ${importJobIds[index]}, ${novelId}, ${importStatus}, 'https://example.test/novel',
            1, 1, 1, ${updatedAt}, ${updatedAt}
          )
        `;
      }

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
    });

    try {
      const metrics: string[] = [];
      const timing = createTiming(metrics);
      const activity = await loadJobActivity(ownerUserId, timing);
      const stats = await loadJobStats(ownerUserId, timing);

      expect(activity.translationJobs).toHaveLength(25);
      expect(activity.translationJobs[0]?.id).toBe(translationJobIds[25]);
      expect(activity.translationJobs.some(({ id }) => id === translationJobIds[0])).toBe(false);
      expect(activity.importJobs).toHaveLength(25);
      expect(activity.importJobs[0]?.id).toBe(importJobIds[25]);
      expect(activity.importJobs.some(({ id }) => id === importJobIds[0])).toBe(false);
      expect(activity.summary).toEqual({
        activeTranslationJobs: 1,
        failedTranslationJobs: 1,
        activeImportJobs: 1,
        failedImportJobs: 1,
      });
      expect(stats).toEqual({
        avgChunkLatencyMs: 15,
        promptTokens: 8,
        completionTokens: 18,
      });
      expect(metrics).toEqual(["translation-jobs", "import-jobs", "chunk-stats"]);
    } finally {
      await sql`DELETE FROM "user" WHERE "id" IN (${ownerUserId}, ${otherUserId})`;
    }
  }, 30_000);
});
