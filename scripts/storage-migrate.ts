import { mock } from "bun:test";
mock.module("server-only", () => ({}));

import { config } from "dotenv";

config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { writeCoverSet } from "@/lib/content/novel/cover-storage.server";
import { log } from "@/lib/log";

/**
 * Moves legacy `novels.cover` bytes into object storage and records the resulting
 * keys in `r2_migration_covers`. Migration 0037 folds that map into `cover_key`
 * and 0038 drops the bytea column, so this script MUST run between them — that is,
 * before `bun run db:migrate` on a database that has not been migrated yet.
 *
 * Idempotent and re-runnable: a novel with a map row is skipped.
 */

const MAP_TABLE = "r2_migration_covers";
const dryRun = process.argv.includes("--dry-run");

interface LegacyCoverRow {
  id: string;
  cover: unknown;
  coverMime: string | null;
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
  }
  return Buffer.from(value as ArrayBuffer);
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS "exists"`,
  );
  return rows.length > 0 && rows[0].exists === true;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
        LIMIT 1`,
  );
  return rows.length > 0;
}

async function backfillCovers(): Promise<{ migrated: number; alreadyMapped: number }> {
  if (!(await columnExists("novels", "cover"))) {
    log("info", "storage migrate: novels.cover is already gone; skipping cover backfill");
    return { migrated: 0, alreadyMapped: 0 };
  }

  if (!dryRun) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ${sql.identifier(MAP_TABLE)} (
        "novel_id" text PRIMARY KEY,
        "cover_key" text NOT NULL,
        "cover_mime" text
      )
    `);
  }

  const hasMapTable = await tableExists(MAP_TABLE);
  const alreadyMappedRows = hasMapTable
    ? await db.execute(sql`
        SELECT count(*)::int AS "count"
        FROM "novels" n
        INNER JOIN ${sql.identifier(MAP_TABLE)} m ON m."novel_id" = n."id"
      `)
    : [{ count: 0 }];
  const alreadyMapped = Number(alreadyMappedRows[0]?.count ?? 0);

  const pending = (await db.execute(sql`
    SELECT n."id" AS "id", n."cover" AS "cover", n."cover_mime" AS "coverMime"
    FROM "novels" n
    WHERE n."cover" IS NOT NULL
    ${
      hasMapTable
        ? sql`AND NOT EXISTS (
            SELECT 1 FROM ${sql.identifier(MAP_TABLE)} m WHERE m."novel_id" = n."id"
          )`
        : sql``
    }
  `)) as unknown as LegacyCoverRow[];

  if (pending.length === 0) {
    log("info", "storage migrate: no legacy covers to move", { alreadyMapped });
    return { migrated: 0, alreadyMapped };
  }

  if (dryRun) {
    log("info", "storage migrate: dry run", { pending: pending.length, alreadyMapped });
    return { migrated: 0, alreadyMapped };
  }

  let migrated = 0;
  for (const row of pending) {
    const buffer = toBuffer(row.cover);
    if (buffer.length === 0) {
      log("warn", "storage migrate: skipping empty cover", { novelId: row.id });
      continue;
    }
    const mime = row.coverMime ?? "image/webp";
    const coverKey = await writeCoverSet(row.id, buffer, mime);
    await db.execute(sql`
      INSERT INTO ${sql.identifier(MAP_TABLE)} ("novel_id", "cover_key", "cover_mime")
      VALUES (${row.id}, ${coverKey}, ${mime})
      ON CONFLICT ("novel_id") DO UPDATE
        SET "cover_key" = EXCLUDED."cover_key", "cover_mime" = EXCLUDED."cover_mime"
    `);
    migrated += 1;
    log("info", "storage migrate: cover moved", {
      novelId: row.id,
      bytes: buffer.length,
      coverKey,
    });
  }

  return { migrated, alreadyMapped };
}

async function assertMapCoversEverything(): Promise<void> {
  if (!(await columnExists("novels", "cover"))) return;
  const uncoveredRows = (await db.execute(sql`
    SELECT count(*)::int AS "count"
    FROM "novels" n
    WHERE n."cover" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${sql.identifier(MAP_TABLE)} m WHERE m."novel_id" = n."id"
      )
  `)) as unknown as Array<{ count: number }>;
  const uncovered = Number(uncoveredRows[0]?.count ?? 0);
  if (uncovered > 0) {
    throw new Error(`${uncovered} novel cover(s) are still not in object storage`);
  }
}

async function reconcileEpubUploads(): Promise<void> {
  if (!(await tableExists("epub_uploads"))) return;

  const byStatus = (await db.execute(sql`
    SELECT "status"::text AS "status", count(*)::int AS "count"
    FROM "epub_uploads"
    GROUP BY "status"
  `)) as unknown as Array<{ status: string; count: number }>;
  const statusCounts = new Map(byStatus.map((row) => [row.status, Number(row.count)]));

  const inFlight = (statusCounts.get("queued") ?? 0) + (statusCounts.get("staged") ?? 0);
  if (inFlight > 0) {
    throw new Error(
      `${inFlight} EPUB upload(s) are queued or staged. Finish or abort them in the app ` +
        "before migrating; a staged archive written by the previous chunked upload path " +
        "does not exist in object storage.",
    );
  }

  const incomplete = (statusCounts.get("uploading") ?? 0) + (statusCounts.get("error") ?? 0);
  if (incomplete === 0) return;

  if (dryRun) {
    log("info", "storage migrate: dry run would remove incomplete EPUB uploads", {
      count: incomplete,
    });
    return;
  }

  // Incomplete uploads hold no archive in object storage and cannot be resumed across
  // this change; object_key is required after the contract migration, so drop them.
  await db.execute(sql`DELETE FROM "epub_uploads" WHERE "status" IN ('uploading', 'error')`);
  log("info", "storage migrate: removed incomplete EPUB uploads", { count: incomplete });
}

async function run(): Promise<void> {
  if (dryRun) log("info", "storage migrate: dry run — no writes will be made");

  const covers = await backfillCovers();
  await reconcileEpubUploads();

  if (dryRun) {
    log("info", "storage migrate: dry run complete", covers);
    return;
  }

  await assertMapCoversEverything();
  log("info", "storage migrate complete", covers);
  console.log("\nNext: run `bun run db:migrate` to fold the keys in and drop the legacy columns.");
}

run()
  .then(async () => {
    const { queryClient } = await import("@/lib/db");
    await queryClient.end({ timeout: 1 });
  })
  .catch(async (error: unknown) => {
    console.error("Storage migration failed:", error);
    process.exitCode = 1;
    const { queryClient } = await import("@/lib/db");
    await queryClient.end({ timeout: 1 }).catch(() => {});
  });
