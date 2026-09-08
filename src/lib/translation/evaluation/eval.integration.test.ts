import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import type * as EvalService from "./eval.service";
import type * as EvalWorker from "./eval-worker";
import type * as Outbox from "@/lib/translation/workflow/outbox";
import type * as ChapterEdit from "@/lib/content/chapter-edit.service";

import { EVAL_SELECTOR_ERROR, evalStoredResultSchema, evalSummarySchema } from "./eval.schemas";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let queueTranslationEvalForUser: typeof EvalService.queueTranslationEvalForUser;
let listTranslationEvalReportsForUser: typeof EvalService.listTranslationEvalReportsForUser;
let getTranslationEvalReportForUser: typeof EvalService.getTranslationEvalReportForUser;
let dispatchTranslationOutboxEvent: typeof Outbox.dispatchTranslationOutboxEvent;
let runTranslationEvalReport: typeof EvalWorker.runTranslationEvalReport;
let failTranslationEvalReport: typeof EvalWorker.failTranslationEvalReport;
let updateChapterForUser: typeof ChapterEdit.updateChapterForUser;
const skipEagerDispatch = async () => {};

type ChapterSeed = {
  id: string;
  number: string;
  title: string;
  rawContent: string;
  translatedContent: string | null;
  status: "raw" | "translated";
};

type Fixture = {
  ownerUserId: string;
  otherUserId: string;
  novelId: string;
  chapterIds: string[];
  reportIds: string[];
};

type ReportRow = {
  status: string;
  chapterCount: number;
  residualScriptLetters: number;
  markerMismatches: number;
  matchedGlossaryTerms: number;
  adheredGlossaryTerms: number;
  error: string | null;
  summaryJson: string | null;
  resultsJson: string | null;
};

function makeChapter(number: string, translatedContent: string | null): ChapterSeed {
  return {
    id: `chapter-${randomUUID()}`,
    number,
    title: `Chapter ${number}`,
    rawContent: `Source ${number}`,
    translatedContent,
    status: translatedContent === null ? "raw" : "translated",
  };
}

async function seedFixture(
  chapters: ChapterSeed[],
  terms: Array<{ source: string; target: string }> = [],
): Promise<Fixture> {
  const ownerUserId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ownerUserId}, 'Evaluation Owner', ${`${ownerUserId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other Owner', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "created_at", "updated_at"
    ) VALUES (${novelId}, ${ownerUserId}, 'Evaluation Novel', 'en', 'th', now(), now())
  `;

  for (const chapter of chapters) {
    await sql`
      INSERT INTO "chapters" (
        "id", "novel_id", "number", "title", "raw_content", "translated_content",
        "status", "raw_char_count", "created_at", "updated_at"
      ) VALUES (
        ${chapter.id}, ${novelId}, ${chapter.number}, ${chapter.title}, ${chapter.rawContent},
        ${chapter.translatedContent}, ${chapter.status}, length(${chapter.rawContent}), now(), now()
      )
    `;
  }
  for (const term of terms) {
    await sql`
      INSERT INTO "glossary_terms" (
        "id", "novel_id", "source", "target", "category", "status", "created_at", "updated_at"
      ) VALUES (${`term-${randomUUID()}`}, ${novelId}, ${term.source}, ${term.target}, 'other', 'approved', now(), now())
    `;
  }

  return {
    ownerUserId,
    otherUserId,
    novelId,
    chapterIds: chapters.map((chapter) => chapter.id),
    reportIds: [],
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  for (const reportId of fixture.reportIds) {
    await sql`
      DELETE FROM "translation_outbox"
      WHERE "payload_json"::jsonb ->> 'reportId' = ${reportId}
    `;
  }
  await sql`DELETE FROM "user" WHERE "id" IN (${fixture.ownerUserId}, ${fixture.otherUserId})`;
}

async function queueReport(fixture: Fixture, selector: string): Promise<string> {
  const { reportId } = await queueTranslationEvalForUser(
    fixture.ownerUserId,
    { novelId: fixture.novelId, chapterSelector: selector },
    skipEagerDispatch,
  );
  fixture.reportIds.push(reportId);
  return reportId;
}

async function readReport(reportId: string): Promise<ReportRow> {
  const [row] = await sql<ReportRow[]>`
    SELECT
      "status",
      "chapter_count" AS "chapterCount",
      "residual_script_letters" AS "residualScriptLetters",
      "marker_mismatches" AS "markerMismatches",
      "matched_glossary_terms" AS "matchedGlossaryTerms",
      "adhered_glossary_terms" AS "adheredGlossaryTerms",
      "error",
      "summary_json" AS "summaryJson",
      "results_json" AS "resultsJson"
    FROM "translation_eval_reports"
    WHERE "id" = ${reportId}
  `;
  return row;
}

function parseCurrentSnapshot(row: ReportRow) {
  const summary = evalSummarySchema.parse(JSON.parse(row.summaryJson ?? "null"));
  const results = evalStoredResultSchema.array().parse(JSON.parse(row.resultsJson ?? "null"));
  return { summary, results };
}

integrationDescribe("translation evaluation workflow PostgreSQL invariants", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";
    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    // Server-only modules must load after the isolated database environment is set.
    ({
      queueTranslationEvalForUser,
      listTranslationEvalReportsForUser,
      getTranslationEvalReportForUser,
    } = await import("./eval.service"));
    ({ runTranslationEvalReport, failTranslationEvalReport } = await import("./eval-worker"));
    ({ dispatchTranslationOutboxEvent } = await import("@/lib/translation/workflow/outbox"));
    ({ updateChapterForUser } = await import("@/lib/content/chapter-edit.service"));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 1 });
  });

  it("rejects invalid selectors and evaluates decimal and first3 selections", async () => {
    const fixture = await seedFixture([
      makeChapter("1", "ดีหนึ่ง"),
      makeChapter("1.5", "ดีหนึ่งครึ่ง"),
      makeChapter("3", "ดีสาม"),
      makeChapter("4", "ดีสี่"),
    ]);
    try {
      for (const selector of ["garbage", "1,,2", "3-1", "1e3", "1.234", " ", "1".repeat(513)]) {
        await expect(
          queueTranslationEvalForUser(
            fixture.ownerUserId,
            { novelId: fixture.novelId, chapterSelector: selector },
            skipEagerDispatch,
          ),
        ).rejects.toThrow(EVAL_SELECTOR_ERROR);
      }
      const [counts] = await sql<{ reports: number; outbox: number }[]>`
        SELECT
          (SELECT count(*)::int FROM "translation_eval_reports" WHERE "novel_id" = ${fixture.novelId}) AS "reports",
          (SELECT count(*)::int FROM "translation_outbox" o JOIN "translation_eval_reports" r ON o."payload_json"::jsonb ->> 'reportId' = r.id WHERE r.novel_id = ${fixture.novelId}) AS "outbox"
      `;
      expect(counts).toEqual({ reports: 0, outbox: 0 });

      const decimalReportId = await queueReport(fixture, "1.5,1-2");
      await runTranslationEvalReport(decimalReportId);
      const decimalSnapshot = parseCurrentSnapshot(await readReport(decimalReportId));
      expect(decimalSnapshot.results.map((result) => result.chapterNumber)).toEqual([
        "1.00",
        "1.50",
      ]);

      const firstThreeReportId = await queueReport(fixture, "first3");
      await runTranslationEvalReport(firstThreeReportId);
      const firstThreeSnapshot = parseCurrentSnapshot(await readReport(firstThreeReportId));
      expect(firstThreeSnapshot.results.map((result) => result.chapterNumber)).toEqual([
        "1.00",
        "1.50",
        "3.00",
      ]);

      const emptyReportId = await queueReport(fixture, "99.99");
      await runTranslationEvalReport(emptyReportId);
      const emptySnapshot = parseCurrentSnapshot(await readReport(emptyReportId));
      expect(emptySnapshot.summary.chapterCount).toBe(0);
      expect(emptySnapshot.results).toEqual([]);
      const sparseReportId = await queueReport(fixture, "0.01-999999.99");
      await runTranslationEvalReport(sparseReportId);
      const sparse = parseCurrentSnapshot(await readReport(sparseReportId));
      expect(sparse.results.map((result) => result.chapterId)).toEqual(fixture.chapterIds);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30_000);

  it("evaluates all chapters beyond the old cutoff and bounds detail pages", async () => {
    const fixture = await seedFixture([]);
    try {
      const chapterPrefix = `bulk-${randomUUID()}-`;
      await sql`
        INSERT INTO "chapters" (
          "id", "novel_id", "number", "title", "raw_content", "translated_content",
          "status", "raw_char_count", "created_at", "updated_at"
        )
        SELECT
          ${chapterPrefix} || series::text,
          ${fixture.novelId},
          series::numeric,
          'Chapter ' || series::text,
          'Source ' || series::text,
          CASE WHEN series = 1001 THEN 'leftover Latin' ELSE 'ดี' END,
          'translated',
          length('Source ' || series::text),
          now(),
          now()
        FROM generate_series(1, 1001) AS series
      `;

      const reportId = await queueReport(fixture, "all");
      await runTranslationEvalReport(reportId);
      const snapshot = parseCurrentSnapshot(await readReport(reportId));
      expect(snapshot.summary).toMatchObject({
        chapterCount: 1001,
        evaluatedChapterCount: 1001,
        skippedChapterCount: 0,
        attentionChapterCount: 1,
      });
      expect(snapshot.results.at(-1)).toMatchObject({ chapterNumber: "1001.00", evaluated: true });

      const detail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "all",
        page: 1,
        pageSize: 10,
      });
      expect(detail.rowCount).toBe(1001);
      expect(detail.rows).toHaveLength(10);
      const attention = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "attention",
        page: 1,
        pageSize: 25,
      });
      expect(attention.rows.map((row) => row.chapterNumber)).toEqual(["1001.00"]);
      expect(attention.rows[0].residualScriptLetters).toBe(13);
      for (const pageSize of [10, 25, 50] as const) {
        const lastPage = await getTranslationEvalReportForUser(fixture.ownerUserId, {
          novelId: fixture.novelId,
          reportId,
          filter: "all",
          page: 999,
          pageSize,
        });
        expect(lastPage.page).toBe(Math.ceil(1001 / pageSize));
        expect(lastPage.rows.map((row) => row.chapterNumber)).toEqual(["1001.00"]);
      }
    } finally {
      await cleanupFixture(fixture);
    }
  }, 60_000);

  it("keeps failed outbox delivery recoverable and terminal reports immutable", async () => {
    const fixture = await seedFixture([makeChapter("1", "ดี")]);
    try {
      let sendAttempts = 0;
      const { reportId } = await queueTranslationEvalForUser(
        fixture.ownerUserId,
        { novelId: fixture.novelId, chapterSelector: "all" },
        async (outboxId) => {
          await dispatchTranslationOutboxEvent(outboxId, async () => {
            sendAttempts += 1;
            if (sendAttempts === 1) throw new Error("network unavailable");
          });
        },
      );
      fixture.reportIds.push(reportId);
      const [pending] = await sql<{ status: string; attempts: number }[]>`
        SELECT "status", "attempts" FROM "translation_outbox"
        WHERE "payload_json"::jsonb ->> 'reportId' = ${reportId}
      `;
      expect(pending).toEqual({ status: "pending", attempts: 1 });

      await sql`
        UPDATE "translation_outbox" SET "available_at" = now() - interval '1 second'
        WHERE "payload_json"::jsonb ->> 'reportId' = ${reportId}
      `;
      const [outbox] = await sql<{ id: string }[]>`
        SELECT "id" FROM "translation_outbox"
        WHERE "payload_json"::jsonb ->> 'reportId' = ${reportId}
      `;
      await expect(
        dispatchTranslationOutboxEvent(outbox.id, async () => {
          sendAttempts += 1;
        }),
      ).resolves.toBe(true);
      await runTranslationEvalReport(reportId);
      const completedBeforeDuplicate = await readReport(reportId);
      await expect(runTranslationEvalReport(reportId)).resolves.toMatchObject({
        skipped: true,
        status: "done",
      });
      expect(await readReport(reportId)).toEqual(completedBeforeDuplicate);

      const failedReportId = await queueReport(fixture, "all");
      await failTranslationEvalReport(failedReportId);
      expect(await readReport(failedReportId)).toMatchObject({
        status: "error",
        error: "Quality check failed. Run it again.",
      });
      await failTranslationEvalReport(failedReportId);
      expect(await readReport(failedReportId)).toMatchObject({
        status: "error",
        error: "Quality check failed. Run it again.",
      });
      await failTranslationEvalReport(reportId);
      expect(await readReport(reportId)).toEqual(completedBeforeDuplicate);
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30_000);

  it("separates skipped chapters from evaluated quality findings and exposes freshness", async () => {
    const fixture = await seedFixture(
      [
        {
          ...makeChapter("1", "Alpha มาแล้ว"),
          rawContent: "Alpha arrived.\n\nBeta waited.",
          title: "Alpha arrives",
        },
        makeChapter("2", null),
      ],
      [{ source: "Alpha", target: "อัลฟา" }],
    );
    try {
      const reportId = await queueReport(fixture, "all");
      await runTranslationEvalReport(reportId);
      const report = await readReport(reportId);
      const snapshot = parseCurrentSnapshot(report);
      expect(snapshot.summary).toMatchObject({
        chapterCount: 2,
        evaluatedChapterCount: 1,
        skippedChapterCount: 1,
        attentionChapterCount: 1,
        markerMismatches: 1,
        matchedGlossaryTerms: 1,
        adheredGlossaryTerms: 0,
      });
      expect(snapshot.results[0]).toMatchObject({
        evaluated: true,
        rawParagraphCount: 2,
        translatedParagraphCount: 1,
        missingGlossaryTerms: [{ source: "Alpha", target: "อัลฟา" }],
      });
      expect(snapshot.results[1]).toMatchObject({
        evaluated: false,
        markerMismatches: 0,
        matchedGlossaryTerms: 0,
        adheredGlossaryTerms: 0,
      });

      const ownerDetail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(ownerDetail.rows).toHaveLength(2);
      const summaries = await listTranslationEvalReportsForUser(
        fixture.ownerUserId,
        fixture.novelId,
      );
      expect(summaries[0]).toMatchObject({ id: reportId, meta: { evaluatedChapterCount: 1 } });
      expect(summaries[0]).not.toHaveProperty("resultsJson");
      expect(summaries[0]).not.toHaveProperty("summaryJson");
      await expect(
        getTranslationEvalReportForUser(fixture.otherUserId, {
          novelId: fixture.novelId,
          reportId,
          filter: "all",
          page: 1,
          pageSize: 25,
        }),
      ).rejects.toThrow("Quality report not found");
      await expect(
        getTranslationEvalReportForUser(fixture.ownerUserId, {
          novelId: `wrong-${fixture.novelId}`,
          reportId,
          filter: "all",
          page: 1,
          pageSize: 25,
        }),
      ).rejects.toThrow("Quality report not found");

      await updateChapterForUser(
        fixture.ownerUserId,
        { chapterId: fixture.chapterIds[0], translatedContent: "อัลฟามาถึง\n\nเบต้ารออยู่" },
        skipEagerDispatch,
      );
      const changedDetail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(changedDetail.rows[0].snapshotState).toBe("changed");
      expect(changedDetail.rows[1].snapshotState).toBe("current");

      const correctedReportId = await queueReport(fixture, "all");
      await runTranslationEvalReport(correctedReportId);
      const correctedDetail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId: correctedReportId,
        filter: "attention",
        page: 1,
        pageSize: 25,
      });
      expect(correctedDetail.rows).toEqual([]);
      expect(correctedDetail.report.meta).toMatchObject({
        evaluatedChapterCount: 1,
        skippedChapterCount: 1,
      });

      await sql`UPDATE "glossary_terms" SET "target" = 'อัลฟาใหม่', "updated_at" = now() WHERE "novel_id" = ${fixture.novelId} AND "source" = 'Alpha'`;
      const staleDetail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(staleDetail.contextChanged).toBe(true);
      expect(staleDetail.rows[0].snapshotState).toBe("changed");

      await sql`DELETE FROM "chapters" WHERE "id" = ${fixture.chapterIds[0]}`;
      const deletedDetail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(deletedDetail.rows[0]).toMatchObject({
        snapshotState: "deleted",
        chapterId: fixture.chapterIds[0],
      });
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30_000);

  it("reads legacy snapshots and marks malformed versions unavailable", async () => {
    const fixture = await seedFixture([makeChapter("1", "ดี")]);
    try {
      const legacyReportId = `legacy-${randomUUID()}`;
      const corruptReportId = `corrupt-${randomUUID()}`;
      fixture.reportIds.push(legacyReportId, corruptReportId);
      const legacySummary = {
        chapterCount: 1,
        residualScriptLetters: 0,
        markerMismatches: 0,
        matchedGlossaryTerms: 0,
        adheredGlossaryTerms: 0,
      };
      const legacyResult = {
        chapterId: fixture.chapterIds[0],
        chapterNumber: "1",
        chapterTitle: "Chapter 1",
        status: "translated",
        residualScriptLetters: 0,
        markerMismatches: 0,
        matchedGlossaryTerms: 0,
        adheredGlossaryTerms: 0,
        glossaryAdherencePercent: null,
      };
      await sql`
        INSERT INTO "translation_eval_reports" (
          "id", "novel_id", "status", "chapter_selector", "chapter_count", "summary_json", "results_json", "completed_at", "created_at", "updated_at"
        ) VALUES (${legacyReportId}, ${fixture.novelId}, 'done', 'first3', 1, ${JSON.stringify(legacySummary)}, ${JSON.stringify([legacyResult])}, now(), now(), now())
      `;
      await sql`
        INSERT INTO "translation_eval_reports" (
          "id", "novel_id", "status", "chapter_selector", "chapter_count", "summary_json", "results_json", "completed_at", "created_at", "updated_at"
        ) VALUES (${corruptReportId}, ${fixture.novelId}, 'done', 'all', 0, '{"version":2}', '[]', now(), now(), now())
      `;

      const legacyDetail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId: legacyReportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(legacyDetail).toMatchObject({
        detailsState: "ready",
        contextChanged: null,
        report: { meta: null },
      });
      expect(legacyDetail.rows[0]).toMatchObject({
        evaluated: null,
        snapshotState: "unknown",
        rawParagraphCount: null,
      });
      await sql`DELETE FROM chapters WHERE id = ${fixture.chapterIds[0]}`;
      const deletedLegacy = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId: legacyReportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(deletedLegacy.rows[0].snapshotState).toBe("deleted");

      const corruptDetail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId: corruptReportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(corruptDetail).toMatchObject({ detailsState: "unavailable", rows: [], rowCount: 0 });
    } finally {
      await cleanupFixture(fixture);
    }
  }, 30_000);

  it("reads Unicode previews, skips whitespace, and inspects retained queued translations", async () => {
    const fixture = await seedFixture(
      [
        { ...makeChapter("1", "𐐀".repeat(150) + "\n\nAPI <tag>"), rawContent: "Alpha\n\n<tag>" },
        makeChapter("2", " \n\t "),
      ],
      [{ source: "Alpha", target: "API" }],
    );
    try {
      await sql`UPDATE chapters SET status = 'queued' WHERE id = ${fixture.chapterIds[0]}`;
      const reportId = await queueReport(fixture, "all");
      await runTranslationEvalReport(reportId);
      const detail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(detail.detailsState).toBe("ready");
      expect(detail.report.meta).toMatchObject({
        evaluatedChapterCount: 1,
        skippedChapterCount: 1,
      });
      expect(detail.rows[0]).toMatchObject({
        status: "queued",
        evaluated: true,
        residualScriptLetters: 150,
        residualSpanCount: 1,
        markerMismatches: 0,
        adheredGlossaryTerms: 1,
        residualExamples: ["𐐀".repeat(119) + "…"],
      });
      expect(detail.rows[1]).toMatchObject({ evaluated: false, markerMismatches: 0 });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects invalid snapshot evidence and inconsistent totals instead of showing a clean report", async () => {
    const fixture = await seedFixture([makeChapter("1", "ดี")]);
    try {
      const reportId = await queueReport(fixture, "all");
      await runTranslationEvalReport(reportId);
      const { summary, results } = parseCurrentSnapshot(await readReport(reportId));
      const corruptions = [
        { summary, rows: [{ ...results[0], chapterNumber: "garbage" }] },
        { summary, rows: [{ ...results[0], chapterUpdatedAt: "not-a-date" }] },
        { summary, rows: [{ ...results[0], status: "future" }] },
        { summary: { ...summary, attentionChapterCount: 1 }, rows: results },
        {
          summary: { ...summary, chapterCount: 2, evaluatedChapterCount: 2 },
          rows: [results[0], results[0]],
        },
      ];
      for (const corruption of corruptions) {
        await sql`UPDATE translation_eval_reports SET summary_json = ${JSON.stringify(corruption.summary)}, results_json = ${JSON.stringify(corruption.rows)} WHERE id = ${reportId}`;
        const detail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
          novelId: fixture.novelId,
          reportId,
          filter: "all",
          page: 1,
          pageSize: 25,
        });
        expect(detail).toMatchObject({ detailsState: "unavailable", rows: [] });
      }
      await sql`UPDATE translation_eval_reports SET summary_json = ${JSON.stringify(summary)}, results_json = ${JSON.stringify(results)}, chapter_count = 2 WHERE id = ${reportId}`;
      const scalarMismatch = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(scalarMismatch).toMatchObject({ detailsState: "unavailable", rows: [] });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rolls back report creation when inserting its outbox event fails", async () => {
    const fixture = await seedFixture([]);
    const triggerName = `eval_rollback_${randomUUID().replaceAll("-", "")}`;
    try {
      // The trigger rejects only this fixture's event, not concurrently running suites.
      await sql.unsafe(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM translation_eval_reports WHERE id = NEW.payload_json::jsonb->>'reportId'
            AND novel_id = '${fixture.novelId}') THEN RAISE EXCEPTION 'fixture outbox insert failed'; END IF;
          RETURN NEW;
        END $$`);
      await sql.unsafe(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON translation_outbox FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`,
      );
      await expect(queueReport(fixture, "all")).rejects.toThrow();
      expect(await listTranslationEvalReportsForUser(fixture.ownerUserId, fixture.novelId)).toEqual(
        [],
      );
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON translation_outbox`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS ${triggerName}()`);
      await cleanupFixture(fixture);
    }
  });

  it("keeps attempt failures retryable and masks legacy internal errors", async () => {
    const fixture = await seedFixture([makeChapter("1", "ดี")]);
    try {
      const reportId = await queueReport(fixture, "all");
      await sql`UPDATE translation_eval_reports SET chapter_selector = 'legacy-invalid' WHERE id = ${reportId}`;
      await expect(runTranslationEvalReport(reportId)).rejects.toThrow(EVAL_SELECTOR_ERROR);
      expect(await readReport(reportId)).toMatchObject({ status: "running", resultsJson: null });
      await sql`UPDATE translation_eval_reports SET chapter_selector = 'all' WHERE id = ${reportId}`;
      await runTranslationEvalReport(reportId);
      const completed = await readReport(reportId);
      await failTranslationEvalReport(reportId);
      expect(await readReport(reportId)).toEqual(completed);
      const failedId = await queueReport(fixture, "all");
      await failTranslationEvalReport(failedId);
      const failed = await readReport(failedId);
      await runTranslationEvalReport(failedId);
      expect(await readReport(failedId)).toEqual(failed);
      await sql`UPDATE translation_eval_reports SET error = 'postgres://private-database-secret' WHERE id = ${failedId}`;
      const detail = await getTranslationEvalReportForUser(fixture.ownerUserId, {
        novelId: fixture.novelId,
        reportId: failedId,
        filter: "all",
        page: 1,
        pageSize: 25,
      });
      expect(detail.report.error).toBe("Quality check failed. Run it again.");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
