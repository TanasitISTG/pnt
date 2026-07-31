import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

function databaseUrl(baseUrl: string, database: string) {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

integrationDescribe("translation chunk migration", () => {
  it("backfills legacy chunks_json once when migration 0022 is applied", async () => {
    const baseUrl = testDatabaseUrl!;
    const database = `pnt_migration_${randomUUID().replaceAll("-", "")}`;
    const admin = postgres(databaseUrl(baseUrl, "postgres"), { max: 1, onnotice: () => {} });
    const partialDir = await mkdtemp(join(tmpdir(), "pnt-migrations-"));
    let target: ReturnType<typeof postgres> | null = null;

    try {
      await admin.unsafe(`CREATE DATABASE "${database}"`);
      target = postgres(databaseUrl(baseUrl, database), { max: 1, onnotice: () => {} });

      const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as {
        entries: Array<{ idx: number }>;
      };
      journal.entries = journal.entries.filter((entry) => entry.idx <= 21);
      await mkdir(join(partialDir, "meta"), { recursive: true });
      await writeFile(join(partialDir, "meta", "_journal.json"), JSON.stringify(journal), "utf8");
      const migrationFiles = await readdir("drizzle");
      for (let index = 0; index <= 21; index += 1) {
        const prefix = index.toString().padStart(4, "0");
        const filename = migrationFiles.find((name) => name.startsWith(`${prefix}_`));
        if (!filename) throw new Error(`Missing migration ${prefix}`);
        await copyFile(join("drizzle", filename), join(partialDir, filename));
      }

      await migrate(drizzle(target), { migrationsFolder: partialDir });

      const userId = `user-${randomUUID()}`;
      const novelId = `novel-${randomUUID()}`;
      const chapterId = `chapter-${randomUUID()}`;
      const jobId = `job-${randomUUID()}`;
      const chunks = [
        { index: 0, text: "first", textLength: 5, hasTranslation: true, translation: "uno" },
        { index: 1, text: "second", textLength: 6, hasTranslation: false },
      ];
      await target`
        INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
        VALUES (${userId}, 'Migration User', ${`${userId}@example.test`}, true, now(), now())
      `;
      await target`
        INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang")
        VALUES (${novelId}, ${userId}, 'Migration Novel', 'zh', 'en')
      `;
      await target`
        INSERT INTO "chapters" (
          "id", "novel_id", "number", "title", "raw_content", "raw_char_count", "status"
        ) VALUES (${chapterId}, ${novelId}, 1, 'Legacy chapter', 'first second', 12, 'raw')
      `;
      await target`
        INSERT INTO "translation_jobs" (
          "id", "chapter_id", "status", "source_revision", "generation",
          "total_chunks", "done_chunks", "chunks_json"
        ) VALUES (${jobId}, ${chapterId}, 'cancelled', 1, 1, 2, 1, ${JSON.stringify(chunks)})
      `;

      await migrate(drizzle(target), { migrationsFolder: "drizzle" });
      await migrate(drizzle(target), { migrationsFolder: "drizzle" });

      const rows = await target<
        Array<{
          index: number;
          sourceText: string;
          textLength: number;
          translation: string | null;
          completedAt: Date | null;
        }>
      >`
        SELECT "chunk_index" AS "index", "source_text" AS "sourceText",
               "text_length" AS "textLength", "translation", "completed_at" AS "completedAt"
        FROM "translation_job_chunks" WHERE "job_id" = ${jobId} ORDER BY "chunk_index"
      `;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        index: 0,
        sourceText: "first",
        textLength: 5,
        translation: "uno",
      });
      expect(rows[0].completedAt).not.toBeNull();
      expect(rows[1]).toMatchObject({
        index: 1,
        sourceText: "second",
        textLength: 6,
        translation: null,
        completedAt: null,
      });
    } finally {
      if (target) await target.end({ timeout: 1 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end({ timeout: 1 });
      await rm(partialDir, { recursive: true, force: true });
    }
  }, 30_000);
});
