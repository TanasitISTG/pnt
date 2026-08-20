import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import * as fflate from "fflate";
import type {
  prepareEpubImportJob as PrepareEpubImportJob,
  initEpubImportJob as InitEpubImportJob,
  importEpubChapterBatch as ImportEpubChapterBatch,
  finishEpubImportJob as FinishEpubImportJob,
  cleanupExpiredEpubUploads as CleanupExpiredEpubUploads,
} from "./worker";
import type { cancelEpubImportJob as CancelEpubImportJob } from "./job-store";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let prepareEpubImportJob: typeof PrepareEpubImportJob;
let initEpubImportJob: typeof InitEpubImportJob;
let importEpubChapterBatch: typeof ImportEpubChapterBatch;
let finishEpubImportJob: typeof FinishEpubImportJob;
let cleanupExpiredEpubUploads: typeof CleanupExpiredEpubUploads;
let cancelEpubImportJob: typeof CancelEpubImportJob;

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

    ({
      prepareEpubImportJob,
      initEpubImportJob,
      importEpubChapterBatch,
      finishEpubImportJob,
      cleanupExpiredEpubUploads,
    } = await import("./worker"));
    ({ cancelEpubImportJob } = await import("./job-store"));

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

    expect(await cancelEpubImportJob(canceledJobId)).toBe(true);
    expect(await importEpubChapterBatch(canceledJobId, 1, 1)).toEqual({ stop: true });

    const [job] = await sql`SELECT "status" FROM "import_jobs" WHERE "id" = ${canceledJobId}`;
    expect(job.status).toBe("cancelled");
    const items = await sql`SELECT * FROM "import_job_items" WHERE "job_id" = ${canceledJobId}`;
    expect(items).toHaveLength(0);
    const uploads = await sql`SELECT * FROM "epub_uploads" WHERE "id" = ${canceledUploadId}`;
    expect(uploads).toHaveLength(0);
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
});
