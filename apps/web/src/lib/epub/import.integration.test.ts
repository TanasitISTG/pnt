import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import { sql as drizzleSql } from "drizzle-orm";
import type * as NovelLocks from "@/lib/db/novel-lock";
import * as fflate from "fflate";
import type {
  prepareEpubImportJob as PrepareEpubImportJob,
  initEpubImportJob as InitEpubImportJob,
  importEpubChapterBatch as ImportEpubChapterBatch,
  finishEpubImportJob as FinishEpubImportJob,
  cleanupExpiredEpubUploads as CleanupExpiredEpubUploads,
} from "./worker";
import type { cancelImportJobForUser as CancelImportJobForUser } from "@/lib/import/commands";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let prepareEpubImportJob: typeof PrepareEpubImportJob;
let initEpubImportJob: typeof InitEpubImportJob;
let importEpubChapterBatch: typeof ImportEpubChapterBatch;
let finishEpubImportJob: typeof FinishEpubImportJob;
let cleanupExpiredEpubUploads: typeof CleanupExpiredEpubUploads;
let cancelImportJobForUser: typeof CancelImportJobForUser;
let novelLocks: typeof NovelLocks;

function pauseNextNovelGate(novelId: string) {
  const original = novelLocks.lockNovelForMutation;
  let release!: () => void;
  let acquired!: (pid: number) => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const locked = new Promise<number>((resolve) => {
    acquired = resolve;
  });
  let claimed = false;
  const spy = vi
    .spyOn(novelLocks, "lockNovelForMutation")
    .mockImplementation(async (tx, id, userId) => {
      const result = await original(tx, id, userId);
      if (result && id === novelId && !claimed) {
        claimed = true;
        const rows = await tx.execute<{ pid: number }>(drizzleSql`SELECT pg_backend_pid() AS pid`);
        acquired(rows[0].pid);
        await released;
      }
      return result;
    });
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

function createTestEpubBuffer(): Uint8Array {
  const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

  const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Integration Test Novel</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="Text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
  </spine>
</package>`;

  const ch1 = `<!DOCTYPE html><html><body><h1>第1章 第一章测试</h1><p>第一章内容开始。</p></body></html>`;
  const ch2 = `<!DOCTYPE html><html><body><h1>第2章 第二章测试</h1><p>第二章内容开始。</p></body></html>`;
  const ch3 = `<!DOCTYPE html><html><body><h1>第三章 未编号</h1><p>第三章内容开始。</p></body></html>`;

  return fflate.zipSync({
    mimetype: fflate.strToU8("application/epub+zip"),
    "META-INF/container.xml": fflate.strToU8(containerXml),
    "content.opf": fflate.strToU8(contentOpf),
    "Text/ch1.xhtml": fflate.strToU8(ch1),
    "Text/ch2.xhtml": fflate.strToU8(ch2),
    "Text/ch3.xhtml": fflate.strToU8(ch3),
  });
}

integrationDescribe("EPUB import PostgreSQL integration", () => {
  const userId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const uploadId = `upload-${randomUUID()}`;
  const jobId = `job-${randomUUID()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    // Defer server-only imports until DATABASE_URL points to the disposable database.
    novelLocks = await import("@/lib/db/novel-lock");

    ({
      prepareEpubImportJob,
      initEpubImportJob,
      importEpubChapterBatch,
      finishEpubImportJob,
      cleanupExpiredEpubUploads,
    } = await import("./worker"));
    ({ cancelImportJobForUser } = await import("@/lib/import/commands"));

    // Seed user and novel
    await sql`
      INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
      VALUES (${userId}, 'EPUB Tester', ${`${userId}@example.test`}, true, now(), now())
    `;
    await sql`
      INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang", "created_at", "updated_at")
      VALUES (${novelId}, ${userId}, 'EPUB Import Test', 'zh', 'en', now(), now())
    `;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM "user" WHERE "id" = ${userId}`.catch(() => {});
      await sql.end({ timeout: 1 });
    }
  });

  it("completes full EPUB import lifecycle: upload persistence, staging, duplicate handling, and cleanup", async () => {
    const epubBytes = createTestEpubBuffer();

    // 1. Persist upload and chunk
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO "epub_uploads" ("id", "novel_id", "file_name", "file_size", "chunk_count", "received_bytes", "status", "expires_at", "created_at", "updated_at")
      VALUES (${uploadId}, ${novelId}, 'test.epub', ${epubBytes.length}, 1, ${epubBytes.length}, 'uploading', ${expiresAt}, now(), now())
    `;
    await sql`
      INSERT INTO "epub_upload_chunks" ("upload_id", "chunk_index", "data")
      VALUES (${uploadId}, 0, ${Buffer.from(epubBytes)})
    `;

    // 2. Create import job
    await sql`
      INSERT INTO "import_jobs" (
        "id", "novel_id", "kind", "status", "base_url", "source_file_name", "epub_upload_id",
        "from_number", "to_number", "next_number", "scrape_provider", "added", "skipped", "failed",
        "created_at", "updated_at"
      ) VALUES (
        ${jobId}, ${novelId}, 'epub', 'pending', ${`epub://${uploadId}`}, 'test.epub', ${uploadId},
        1, 0, 1, 'epub', 0, 0, 0,
        now(), now()
      )
    `;

    // 3. Prepare job: parses archive, stages items, removes chunks
    const prep = await prepareEpubImportJob(jobId);
    expect(prep.skip).toBe(false);
    expect(prep.total).toBe(3);

    // Verify upload status changed to 'staged' and chunks were removed
    const [uploadRow] = await sql`SELECT "status" FROM "epub_uploads" WHERE "id" = ${uploadId}`;
    expect(uploadRow.status).toBe("staged");

    const chunks = await sql`SELECT * FROM "epub_upload_chunks" WHERE "upload_id" = ${uploadId}`;
    expect(chunks.length).toBe(0);

    // Verify staged items
    const stagedItems =
      await sql`SELECT * FROM "import_job_items" WHERE "job_id" = ${jobId} ORDER BY "sequence" ASC`;
    expect(stagedItems.length).toBe(3);
    expect(stagedItems[0].sequence).toBe(1);
    expect(stagedItems[0].chapter_number).toBe("1.00");
    expect(stagedItems[0].title).toBe("第一章测试");
    expect(stagedItems[1].sequence).toBe(2);
    expect(stagedItems[1].chapter_number).toBe("2.00");
    expect(stagedItems[2].sequence).toBe(3);
    expect(stagedItems[2].chapter_number).toBe("3.00"); // fallback unnumbered

    // 4. Init job: changes status to running
    const init = await initEpubImportJob(jobId);
    expect(init.skip).toBe(false);
    expect(init.next).toBe(1);
    expect(init.to).toBe(3);

    const [jobRunning] = await sql`SELECT "status" FROM "import_jobs" WHERE "id" = ${jobId}`;
    expect(jobRunning.status).toBe("running");

    const ch1Res = await importEpubChapterBatch(jobId, 1, 1);
    expect(ch1Res).toEqual({ stop: false });

    // 6. Import chapter 2
    const ch2Res = await importEpubChapterBatch(jobId, 2, 2);
    expect(ch2Res).toEqual({ stop: false });

    // 7. Test duplicate skip: insert existing chapter with number 3 before running sequence 3
    const dupChapterId = `dup-${randomUUID()}`;
    await sql`
      INSERT INTO "chapters" ("id", "novel_id", "number", "title", "raw_content", "raw_char_count", "status", "created_at", "updated_at")
      VALUES (${dupChapterId}, ${novelId}, 3, 'Pre-existing chapter 3', 'Pre-existing body', 17, 'raw', now(), now())
    `;

    // Sequence 3 should detect conflict and skip without failing
    const ch3Res = await importEpubChapterBatch(jobId, 3, 3);
    expect(ch3Res).toEqual({ stop: false });

    // Verify job counters
    const [jobProgress] =
      await sql`SELECT "added", "skipped", "failed", "next_number" FROM "import_jobs" WHERE "id" = ${jobId}`;
    expect(jobProgress.added).toBe(2);
    expect(jobProgress.skipped).toBe(1);
    expect(jobProgress.failed).toBe(0);
    expect(jobProgress.next_number).toBe(4);

    // 8. Finish job: marks done, cleans staged items and upload row
    await finishEpubImportJob(jobId);

    const [jobDone] = await sql`SELECT "status" FROM "import_jobs" WHERE "id" = ${jobId}`;
    expect(jobDone.status).toBe("done");

    const remainingItems = await sql`SELECT * FROM "import_job_items" WHERE "job_id" = ${jobId}`;
    expect(remainingItems.length).toBe(0);

    const remainingUpload = await sql`SELECT * FROM "epub_uploads" WHERE "id" = ${uploadId}`;
    expect(remainingUpload.length).toBe(0);

    // Verify chapters exist in DB
    const finalChapters =
      await sql`SELECT "number", "title" FROM "chapters" WHERE "novel_id" = ${novelId} ORDER BY "number" ASC`;
    expect(finalChapters.length).toBe(3);
    expect(finalChapters[0].number).toBe("1.00");
    expect(finalChapters[1].number).toBe("2.00");
    expect(finalChapters[2].number).toBe("3.00");
    expect(finalChapters[2].title).toBe("Pre-existing chapter 3"); // preserved, not overwritten!
  });

  it("cancels a running EPUB job atomically before its next item", async () => {
    const canceledJobId = `job-canceled-${randomUUID()}`;
    const canceledUploadId = `upload-canceled-${randomUUID()}`;
    const canceledItemId = `item-canceled-${randomUUID()}`;
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);

    await sql`
      INSERT INTO "epub_uploads" ("id", "novel_id", "file_name", "file_size", "chunk_count", "received_bytes", "status", "expires_at", "created_at", "updated_at")
      VALUES (${canceledUploadId}, ${novelId}, 'canceled.epub', 0, 0, 0, 'staged', ${futureDate}, now(), now())
    `;
    await sql`
      INSERT INTO "import_jobs" (
        "id", "novel_id", "kind", "status", "base_url", "source_file_name", "epub_upload_id",
        "from_number", "to_number", "next_number", "scrape_provider", "created_at", "updated_at"
      ) VALUES (
        ${canceledJobId}, ${novelId}, 'epub', 'running', ${`epub://${canceledUploadId}`}, 'canceled.epub',
        ${canceledUploadId}, 1, 1, 1, 'epub', now(), now()
      )
    `;
    await sql`
      INSERT INTO "import_job_items" (
        "id", "job_id", "sequence", "chapter_number", "title", "raw_content", "raw_char_count",
        "status", "created_at", "updated_at"
      ) VALUES (
        ${canceledItemId}, ${canceledJobId}, 1, 1, 'Pending chapter', 'Pending body', 12,
        'pending', now(), now()
      )
    `;

    const cancellation = await cancelImportJobForUser(userId, canceledJobId, async () => {});
    expect(cancellation.cancelled).toBe(true);
    expect(cancellation.outboxIds).toHaveLength(1);
    expect(await importEpubChapterBatch(canceledJobId, 1, 1)).toEqual({ stop: true });

    const [job] = await sql`SELECT "status" FROM "import_jobs" WHERE "id" = ${canceledJobId}`;
    expect(job.status).toBe("cancelled");
    const items = await sql`SELECT * FROM "import_job_items" WHERE "job_id" = ${canceledJobId}`;
    expect(items).toHaveLength(0);
    const uploads = await sql`SELECT * FROM "epub_uploads" WHERE "id" = ${canceledUploadId}`;
    expect(uploads).toHaveLength(0);
    await sql`DELETE FROM "workflow_outbox" WHERE "id" = ${cancellation.outboxIds[0]}`;
  });

  it("keeps legacy scrape jobs on the scrape kind default", async () => {
    const scrapeJobId = `job-scrape-default-${randomUUID()}`;
    await sql`
      INSERT INTO "import_jobs" (
        "id", "novel_id", "status", "base_url", "from_number", "to_number", "next_number",
        "scrape_provider", "created_at", "updated_at"
      ) VALUES (
        ${scrapeJobId}, ${novelId}, 'pending', 'https://example.com/1.html', 1, 1, 1,
        'auto', now(), now()
      )
    `;

    const [job] = await sql`SELECT "kind" FROM "import_jobs" WHERE "id" = ${scrapeJobId}`;
    expect(job.kind).toBe("scrape");
    await sql`DELETE FROM "import_jobs" WHERE "id" = ${scrapeJobId}`;
  });

  it("cleans up expired uploads whose status is uploading", async () => {
    const expiredUploadId = `upload-exp-${randomUUID()}`;
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 25); // 25 hours ago

    await sql`
      INSERT INTO "epub_uploads" ("id", "novel_id", "file_name", "file_size", "chunk_count", "received_bytes", "status", "expires_at", "created_at", "updated_at")
      VALUES (${expiredUploadId}, ${novelId}, 'expired.epub', 100, 1, 100, 'uploading', ${pastDate}, now(), now())
    `;
    await sql`
      INSERT INTO "epub_upload_chunks" ("upload_id", "chunk_index", "data")
      VALUES (${expiredUploadId}, 0, ${Buffer.from([1, 2, 3])})
    `;

    const cleaned = await cleanupExpiredEpubUploads();
    expect(cleaned).toBeGreaterThanOrEqual(1);

    const checkUpload = await sql`SELECT * FROM "epub_uploads" WHERE "id" = ${expiredUploadId}`;
    expect(checkUpload.length).toBe(0);

    const checkChunks =
      await sql`SELECT * FROM "epub_upload_chunks" WHERE "upload_id" = ${expiredUploadId}`;
    expect(checkChunks.length).toBe(0);
  });

  it("rejects a staging upload from a different novel without touching either resource", async () => {
    const { stageImportJobItems } = await import("./job-store");
    const otherNovelId = `novel-${randomUUID()}`;
    const ownUploadId = `upload-${randomUUID()}`;
    const foreignUploadId = `upload-${randomUUID()}`;
    const stagingJobId = `job-${randomUUID()}`;
    await sql`INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang")
      VALUES (${otherNovelId}, ${userId}, 'Other EPUB', 'zh', 'en')`;
    try {
      for (const [id, parent] of [
        [ownUploadId, novelId],
        [foreignUploadId, otherNovelId],
      ]) {
        await sql`INSERT INTO "epub_uploads"
          ("id", "novel_id", "file_name", "file_size", "chunk_count", "received_bytes", "status", "expires_at")
          VALUES (${id}, ${parent}, 'source.epub', 3, 1, 3, 'queued', now() + interval '1 day')`;
        await sql`INSERT INTO "epub_upload_chunks" ("upload_id", "chunk_index", "data")
          VALUES (${id}, 0, ${Buffer.from([1, 2, 3])})`;
      }
      await sql`INSERT INTO "import_jobs"
        ("id", "novel_id", "kind", "status", "base_url", "epub_upload_id", "from_number", "to_number", "next_number", "scrape_provider")
        VALUES (${stagingJobId}, ${novelId}, 'epub', 'running', 'epub://source', ${ownUploadId}, 1, 0, 1, 'epub')`;
      await expect(
        stageImportJobItems(stagingJobId, foreignUploadId, [
          {
            sequence: 1,
            chapterNumber: "30",
            title: "Chapter",
            rawContent: "Body",
            rawCharCount: 4,
          },
        ]),
      ).rejects.toThrow("EPUB staging upload does not match import job");
      expect(
        await sql`SELECT "id" FROM "import_job_items" WHERE "job_id" = ${stagingJobId}`,
      ).toHaveLength(0);
      for (const id of [ownUploadId, foreignUploadId]) {
        const [upload] = await sql`SELECT "status" FROM "epub_uploads" WHERE "id" = ${id}`;
        expect(upload.status).toBe("queued");
        const [chunk] =
          await sql`SELECT "data" FROM "epub_upload_chunks" WHERE "upload_id" = ${id}`;
        expect(Buffer.from(chunk.data)).toEqual(Buffer.from([1, 2, 3]));
      }
    } finally {
      await sql`DELETE FROM "import_jobs" WHERE "id" = ${stagingJobId}`;
      await sql`DELETE FROM "epub_uploads" WHERE "id" = ${ownUploadId}`;
      await sql`DELETE FROM "novels" WHERE "id" = ${otherNovelId}`;
    }
  });

  it.each([
    ["stage", "delete"],
    ["stage", "import"],
    ["chapter", "delete"],
    ["chapter", "import"],
  ] as const)("serializes EPUB %s with %s winning the novel gate", async (operation, winner) => {
    // These server-only modules must load after the disposable DATABASE_URL is set.
    const { stageImportJobItems, importOneStagedChapter } = await import("./job-store");
    const { deleteNovelForUser } = await import("@/lib/content/novel/novel-edit.service");
    const parentId = `novel-${randomUUID()}`;
    const resourceId = `upload-${randomUUID()}`;
    const activeJobId = `job-${randomUUID()}`;
    await sql`INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang")
      VALUES (${parentId}, ${userId}, 'EPUB deletion race', 'zh', 'en')`;
    await sql`INSERT INTO "epub_uploads"
      ("id", "novel_id", "file_name", "file_size", "chunk_count", "received_bytes", "status", "expires_at")
      VALUES (${resourceId}, ${parentId}, 'source.epub', 3, 1, 3, ${operation === "stage" ? "queued" : "staged"}, now() + interval '1 day')`;
    await sql`INSERT INTO "epub_upload_chunks" ("upload_id", "chunk_index", "data")
      VALUES (${resourceId}, 0, ${Buffer.from([1, 2, 3])})`;
    await sql`INSERT INTO "import_jobs"
      ("id", "novel_id", "kind", "status", "base_url", "epub_upload_id", "from_number", "to_number", "next_number", "scrape_provider")
      VALUES (${activeJobId}, ${parentId}, 'epub', 'running', 'epub://source', ${resourceId}, 1, 1, 1, 'epub')`;
    if (operation === "chapter") {
      await sql`INSERT INTO "import_job_items"
        ("id", "job_id", "sequence", "chapter_number", "title", "raw_content", "raw_char_count", "status")
        VALUES (${`item-${randomUUID()}`}, ${activeJobId}, 1, 1, 'Imported', 'Body', 4, 'pending')`;
    }
    const gate = pauseNextNovelGate(parentId);
    const pending: Promise<unknown>[] = [];
    const advance = () =>
      operation === "stage"
        ? stageImportJobItems(activeJobId, resourceId, [
            {
              sequence: 1,
              chapterNumber: "1",
              title: "Imported",
              rawContent: "Body",
              rawCharCount: 4,
            },
          ])
        : importOneStagedChapter(activeJobId, 1);
    let dispatchSnapshot: number[] | undefined;
    const remove = () =>
      deleteNovelForUser(userId, parentId, async () => {
        dispatchSnapshot = [
          (await sql`SELECT "id" FROM "novels" WHERE "id" = ${parentId}`).length,
          (await sql`SELECT "id" FROM "epub_uploads" WHERE "id" = ${resourceId}`).length,
          (await sql`SELECT "id" FROM "import_job_items" WHERE "job_id" = ${activeJobId}`).length,
          (
            await sql`SELECT "chunk_index" FROM "epub_upload_chunks" WHERE "upload_id" = ${resourceId}`
          ).length,
        ];
        // Eager failure must not undo the committed cascade or lose its durable intent.
        throw new Error("Dispatch unavailable");
      });
    try {
      const first = winner === "delete" ? remove() : advance();
      pending.push(first);
      const pid = await bounded(gate.locked);
      const second = winner === "delete" ? advance() : remove();
      pending.push(second);
      await waitForNovelWaiter(pid);
      await sql.begin(async (tx) => {
        await tx`SELECT "id" FROM "import_jobs" WHERE "id" = ${activeJobId} FOR UPDATE NOWAIT`;
        await tx`SELECT "id" FROM "epub_uploads" WHERE "id" = ${resourceId} FOR UPDATE NOWAIT`;
      });
      gate.release();
      const results = await bounded(Promise.all([first, second]));
      expect(dispatchSnapshot).toEqual([0, 0, 0, 0]);
      expect(results[winner === "delete" ? 1 : 0]).toEqual(
        operation === "stage"
          ? winner === "delete"
            ? 0
            : 1
          : winner === "delete"
            ? { stop: true }
            : { stop: false, action: "added" },
      );
      expect(await sql`SELECT "id" FROM "chapters" WHERE "novel_id" = ${parentId}`).toHaveLength(0);
      const events = await sql`SELECT "event_name", "status", "payload_json" FROM "workflow_outbox"
        WHERE "payload_json"::jsonb ->> 'jobId' = ${activeJobId}`;
      expect(events.map((row) => [row.event_name, row.status])).toEqual([
        ["epub/import.cancelled", "pending"],
      ]);
      expect(JSON.parse(events[0].payload_json)).toEqual({ jobId: activeJobId });
    } finally {
      gate.release();
      await Promise.allSettled(pending);
      gate.restore();
      await sql`DELETE FROM "workflow_outbox" WHERE "payload_json"::jsonb ->> 'jobId' = ${activeJobId}`;
      await sql`DELETE FROM "novels" WHERE "id" = ${parentId}`;
    }
  });

  it("rechecks uploading status after expiry cleanup waits for a novel gate", async () => {
    // Server-only connection must be initialized against the disposable database first.
    const { db } = await import("@/lib/db");
    const parentId = `novel-${randomUUID()}`;
    const resourceId = `upload-${randomUUID()}`;
    await sql`INSERT INTO "novels" ("id", "user_id", "title", "source_lang", "target_lang")
      VALUES (${parentId}, ${userId}, 'Expiry race', 'zh', 'en')`;
    await sql`INSERT INTO "epub_uploads"
      ("id", "novel_id", "file_name", "file_size", "chunk_count", "received_bytes", "status", "expires_at")
      VALUES (${resourceId}, ${parentId}, 'source.epub', 3, 1, 3, 'uploading', now() - interval '1 day')`;
    await sql`INSERT INTO "epub_upload_chunks" ("upload_id", "chunk_index", "data")
      VALUES (${resourceId}, 0, ${Buffer.from([1, 2, 3])})`;
    const gate = pauseNextNovelGate(parentId);
    const pending: Promise<unknown>[] = [];
    try {
      const queue = db.transaction(async (tx) => {
        await novelLocks.lockNovelForMutation(tx, parentId, userId);
        await tx.execute(
          drizzleSql`UPDATE "epub_uploads" SET "status" = 'queued' WHERE "id" = ${resourceId}`,
        );
      });
      pending.push(queue);
      const pid = await bounded(gate.locked);
      const cleanup = cleanupExpiredEpubUploads();
      pending.push(cleanup);
      await waitForNovelWaiter(pid);
      gate.release();
      await bounded(Promise.all([queue, cleanup]));
      const [upload] = await sql`SELECT "status" FROM "epub_uploads" WHERE "id" = ${resourceId}`;
      expect(upload.status).toBe("queued");
      const [chunk] =
        await sql`SELECT "data" FROM "epub_upload_chunks" WHERE "upload_id" = ${resourceId}`;
      expect(Buffer.from(chunk.data)).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      gate.release();
      await Promise.allSettled(pending);
      gate.restore();
      await sql`DELETE FROM "novels" WHERE "id" = ${parentId}`;
    }
  });
});
