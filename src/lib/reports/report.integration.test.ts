import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import type { ReportQueueInput } from "./schemas";
import { REPORT_CASE_PAGE_SIZE } from "./schemas";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
/**
 * Imported in `beforeAll`, never at the top of the file: the service pulls in the pooled
 * database client, which binds `DATABASE_URL` when it is first imported. A static import
 * would bind the application database before the test could point the process at the
 * disposable one.
 */
let createNovelReportForUser: typeof import("./report.service.server").createNovelReportForUser;
let getOpenNovelReportForUser: typeof import("./report.service.server").getOpenNovelReportForUser;
let countOpenReportCases: typeof import("./report.service.server").countOpenReportCases;
let listReportCases: typeof import("./report.service.server").listReportCases;
let listReportHistory: typeof import("./report.service.server").listReportHistory;
let resolveReportCaseForOperator: typeof import("./report.service.server").resolveReportCaseForOperator;

let authorId: string;
let authorEmail: string;
let reporterId: string;
let reporterEmail: string;
let secondReporterId: string;
let secondReporterEmail: string;
let operatorId: string;
let operatorEmail: string;

let liveNovelId: string;
let draftNovelId: string;
let ownNovelId: string;
let deletedNovelId: string;
let searchNovelId: string;

const liveTitle = "Reported Novel Fixture";
const deletedTitle = "Deleted Novel Fixture";
const searchTitle = "Queue Search Fixture";

/** The orphan case's key once its novel is deleted: a report of its own, not a novel id. */
let deletedCaseKey: string;

function queue(overrides: Partial<ReportQueueInput> = {}): ReportQueueInput {
  return { tab: "open", q: "", page: 1, pageSize: REPORT_CASE_PAGE_SIZE, ...overrides };
}

/**
 * The app's timestamps are `timestamp` columns without a zone, and Drizzle writes them as
 * UTC ISO strings whose offset Postgres then ignores. Passing a `Date` object here instead
 * would let the driver convert it to local time first, which on a machine east of UTC puts
 * a published fixture in the future - and the fixture would then be invisible to every
 * `published_at <= now` read. The cast pins the parameter to the same shape the app writes.
 */
const timestamp = (value: Date) => sql`${value.toISOString()}::timestamp`;

async function insertUser(id: string, email: string, role: string | null): Promise<void> {
  const now = new Date();
  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "role", "created_at", "updated_at")
    VALUES (${id}, 'Report Test User', ${email}, true, ${role}, ${timestamp(now)}, ${timestamp(now)})
  `;
}

async function insertNovel(input: {
  id: string;
  userId: string;
  title: string;
  publishedAt: Date | null;
}): Promise<void> {
  const now = new Date();
  await sql`
    INSERT INTO "novels"
      ("id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at")
    VALUES (${input.id}, ${input.userId}, ${input.title}, 'zh', 'th', ${input.publishedAt ? timestamp(input.publishedAt) : null}, ${timestamp(now)}, ${timestamp(now)})
  `;
}

integrationDescribe("novel reporting", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-bytes";
    process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
    process.env.APP_ENCRYPTION_KEY ||= "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1lbm91Z2g=";
    process.env.INNGEST_DEV ||= "1";

    sql = postgres(testDatabaseUrl!, { max: 10, onnotice: () => {} });
    ({
      createNovelReportForUser,
      getOpenNovelReportForUser,
      countOpenReportCases,
      listReportCases,
      listReportHistory,
      resolveReportCaseForOperator,
    } = await import("./report.service.server"));

    // The reports table belongs to this suite and the database is disposable, so the
    // queue counts below are exact numbers rather than a baseline plus an offset.
    await sql`DELETE FROM "reports"`;

    authorId = `report-author-${randomUUID()}`;
    authorEmail = `${authorId}@example.test`;
    reporterId = `report-reporter-${randomUUID()}`;
    reporterEmail = `${reporterId}@example.test`;
    secondReporterId = `report-reporter-two-${randomUUID()}`;
    secondReporterEmail = `${secondReporterId}@example.test`;
    operatorId = `report-operator-${randomUUID()}`;
    operatorEmail = `${operatorId}@example.test`;

    await insertUser(authorId, authorEmail, "user");
    await insertUser(reporterId, reporterEmail, "user");
    await insertUser(secondReporterId, secondReporterEmail, "user");
    await insertUser(operatorId, operatorEmail, "admin");

    liveNovelId = `novel-${randomUUID()}`;
    draftNovelId = `novel-${randomUUID()}`;
    ownNovelId = `novel-${randomUUID()}`;
    deletedNovelId = `novel-${randomUUID()}`;
    searchNovelId = `novel-${randomUUID()}`;

    await insertNovel({
      id: liveNovelId,
      userId: authorId,
      title: liveTitle,
      publishedAt: new Date(Date.now() - 3_600_000),
    });
    await insertNovel({
      id: draftNovelId,
      userId: authorId,
      title: "Draft Fixture",
      publishedAt: null,
    });
    await insertNovel({
      id: ownNovelId,
      userId: reporterId,
      title: "Reporter's Own Fixture",
      publishedAt: new Date(Date.now() - 3_600_000),
    });
    await insertNovel({
      id: deletedNovelId,
      userId: authorId,
      title: deletedTitle,
      publishedAt: new Date(Date.now() - 3_600_000),
    });
    await insertNovel({
      id: searchNovelId,
      userId: authorId,
      title: searchTitle,
      publishedAt: new Date(Date.now() - 3_600_000),
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM "reports" WHERE "reporter_user_id" IN (${reporterId}, ${secondReporterId})`;
    await sql`DELETE FROM "admin_audit_log" WHERE "actor_id" = ${operatorId}`;
    await sql`DELETE FROM "novels" WHERE "user_id" = ${authorId} OR "user_id" = ${reporterId}`;
    await sql`DELETE FROM "user" WHERE "id" IN (${authorId}, ${reporterId}, ${secondReporterId}, ${operatorId})`;
    await sql.end({ timeout: 1 });
  });

  it("files one report as one case the operator can read", async () => {
    const report = await createNovelReportForUser(reporterId, {
      novelId: liveNovelId,
      reason: "copyright",
      details: "A repost of a licensed translation.",
    });
    expect(report.novelId).toBe(liveNovelId);

    const own = await getOpenNovelReportForUser(reporterId, liveNovelId);
    expect(own).toMatchObject({ id: report.id, status: "open" });

    const page = await listReportCases(queue());
    expect(page).toMatchObject({ rowCount: 1, page: 1, pageSize: REPORT_CASE_PAGE_SIZE });
    expect(page.cases).toHaveLength(1);

    const [onlyCase] = page.cases;
    expect(onlyCase).toMatchObject({
      caseKey: liveNovelId,
      openCount: 1,
      reasons: ["copyright"],
      truncated: false,
      target: {
        novelId: liveNovelId,
        title: liveTitle,
        ownerId: authorId,
        ownerEmail: authorEmail,
      },
    });
    expect(onlyCase!.entries).toHaveLength(1);
    expect(onlyCase!.entries[0]).toMatchObject({
      id: report.id,
      reporterUserId: reporterId,
      reporterEmail,
      reason: "copyright",
      details: "A repost of a licensed translation.",
    });
    expect(onlyCase!.firstReportedAt).toBeInstanceOf(Date);
    expect(onlyCase!.lastReportedAt).toBeInstanceOf(Date);
  });

  it("refuses a repeat from the same account and lets another account join the case", async () => {
    // Re-filing is refused by the partial unique index, not by a read-then-write check,
    // so two concurrent submits cannot both land.
    await expect(
      createNovelReportForUser(reporterId, { novelId: liveNovelId, reason: "spam_or_scam" }),
    ).rejects.toThrow("You already have an open report for this novel.");

    await createNovelReportForUser(secondReporterId, {
      novelId: liveNovelId,
      reason: "sexual_content",
    });

    const page = await listReportCases(queue());
    expect(page.cases).toHaveLength(1);
    expect(page.cases[0]).toMatchObject({ caseKey: liveNovelId, openCount: 2, truncated: false });
    expect(page.cases[0]!.entries).toHaveLength(2);
    expect(new Set(page.cases[0]!.entries.map((entry) => entry.reporterUserId))).toEqual(
      new Set([reporterId, secondReporterId]),
    );
    expect(new Set(page.cases[0]!.reasons)).toEqual(new Set(["copyright", "sexual_content"]));

    // The count is cases, not reports: an operator works one decision per novel, so two
    // reports on it are one thing to do, and the queue badge must not say two.
    expect(await countOpenReportCases()).toBe(1);
  });

  it("refuses a novel the reporter cannot read and a novel of their own", async () => {
    await expect(
      createNovelReportForUser(secondReporterId, { novelId: draftNovelId, reason: "spam_or_scam" }),
    ).rejects.toThrow("Novel not found or unauthorized");

    // A live novel of the reporter's own is readable, so this refusal is the self-report
    // rule rather than visibility: authors report content, they do not report themselves.
    await expect(
      createNovelReportForUser(reporterId, { novelId: ownNovelId, reason: "copyright" }),
    ).rejects.toThrow("You cannot report your own novel.");
  });

  it("decides every report in a case at once and refuses a second decision", async () => {
    const resolved = await resolveReportCaseForOperator(
      { id: operatorId, email: operatorEmail },
      { caseKey: liveNovelId, decision: "upheld", note: "Stolen text confirmed." },
    );
    expect(resolved).toEqual({ resolvedCount: 2, novelId: liveNovelId });

    const stored = await sql<
      { status: string; resolution_note: string | null; resolved_by_email: string | null }[]
    >`
      SELECT "status", "resolution_note", "resolved_by_email"
      FROM "reports" WHERE "novel_id" = ${liveNovelId}
    `;
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(row).toEqual({
        status: "upheld",
        resolution_note: "Stolen text confirmed.",
        resolved_by_email: operatorEmail,
      });
    }

    // The decision is recorded for the account whose conduct it is about, which is what
    // the snapshot on the report exists for.
    const [audit] = await sql<
      { action: string; target_user_id: string | null; detail: Record<string, unknown> }[]
    >`
      SELECT "action", "target_user_id", "detail" FROM "admin_audit_log"
      WHERE "actor_id" = ${operatorId} AND "action" = 'report.upheld'
    `;
    expect(audit).toMatchObject({ action: "report.upheld", target_user_id: authorId });
    expect(audit!.detail).toEqual({ novelId: liveNovelId, novelTitle: liveTitle, reports: 2 });

    // Deciding closes the case, so the reporter is free to report the novel again and the
    // queue no longer holds a case with nothing left to do.
    expect(await getOpenNovelReportForUser(reporterId, liveNovelId)).toBeNull();
    expect(await countOpenReportCases()).toBe(0);
    expect((await listReportCases(queue())).rowCount).toBe(0);

    await expect(
      resolveReportCaseForOperator(
        { id: operatorId, email: operatorEmail },
        { caseKey: liveNovelId, decision: "dismissed" },
      ),
    ).rejects.toThrow("That case has already been decided.");

    const history = await listReportHistory(queue({ tab: "history" }));
    expect(history.rowCount).toBe(2);
    expect(history.rows.every((row) => row.status === "upheld")).toBe(true);
    expect(history.rows.every((row) => row.resolutionNote === "Stolen text confirmed.")).toBe(true);
    expect(history.rows.every((row) => row.resolvedByEmail === operatorEmail)).toBe(true);
    expect(new Set(history.rows.map((row) => row.reporterEmail))).toEqual(
      new Set([reporterEmail, secondReporterEmail]),
    );
    expect(history.rows.every((row) => row.novelTitle === liveTitle)).toBe(true);
  });

  it("keeps a case legible and closable after its novel is deleted", async () => {
    const report = await createNovelReportForUser(reporterId, {
      novelId: deletedNovelId,
      reason: "hate_or_harassment",
    });
    deletedCaseKey = report.id;

    await sql`DELETE FROM "novels" WHERE "id" = ${deletedNovelId}`;

    const page = await listReportCases(queue());
    expect(page.cases).toHaveLength(1);
    const [orphan] = page.cases;
    // The novel id is gone, so the case is keyed by a report of its own - and the title
    // the operator decides on is the one recorded when it was reported.
    expect(orphan).toMatchObject({
      caseKey: deletedCaseKey,
      target: { novelId: null, title: deletedTitle, ownerEmail: null },
    });

    const resolved = await resolveReportCaseForOperator(
      { id: operatorId, email: operatorEmail },
      { caseKey: deletedCaseKey, decision: "dismissed", note: "The novel is already gone." },
    );
    expect(resolved).toEqual({ resolvedCount: 1, novelId: null });

    // The account the case was about is still named in the audit trail even though the
    // novel it pointed at no longer exists.
    const [audit] = await sql<{ target_user_id: string | null; detail: Record<string, unknown> }[]>`
      SELECT "target_user_id", "detail" FROM "admin_audit_log"
      WHERE "actor_id" = ${operatorId} AND "action" = 'report.dismissed'
    `;
    expect(audit).toMatchObject({ target_user_id: authorId });

    const history = await listReportHistory(queue({ tab: "history", q: deletedTitle }));
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({
      status: "dismissed",
      novelId: null,
      novelTitle: deletedTitle,
    });
  });

  it("finds open cases by title or by the owner's address, and pages them", async () => {
    // Reporting a novel again after a decision is allowed: that is how a member says
    // "this is still wrong", and it opens a fresh case rather than reopening the old one.
    const report = await createNovelReportForUser(reporterId, {
      novelId: searchNovelId,
      reason: "other",
      details: "Something else is off about this one.",
    });
    expect(report.novelId).toBe(searchNovelId);

    const byTitle = await listReportCases(queue({ q: searchTitle }));
    expect(byTitle.cases.map((entry) => entry.caseKey)).toEqual([searchNovelId]);

    // Owner matching is what makes "everything from this account" work; the deleted
    // novel's case is not found this way because its novel row, and so its owner, is gone.
    const byOwner = await listReportCases(queue({ q: authorEmail }));
    expect(byOwner.cases.map((entry) => entry.caseKey)).toEqual([searchNovelId]);

    const noMatch = await listReportCases(queue({ q: "no such novel at all" }));
    expect(noMatch).toMatchObject({ rowCount: 0, cases: [] });

    // A second open case for the paging below. It is owned by the reporting member rather
    // than the author, so the owner search above still has exactly one match.
    await createNovelReportForUser(secondReporterId, {
      novelId: ownNovelId,
      reason: "spam_or_scam",
    });

    const firstPage = await listReportCases(queue({ pageSize: 1 }));
    expect(firstPage).toMatchObject({ rowCount: 2, page: 1 });
    expect(firstPage.cases).toHaveLength(1);
    const secondPage = await listReportCases(queue({ pageSize: 1, page: 2 }));
    expect(secondPage.cases).toHaveLength(1);
    expect(new Set([firstPage.cases[0]!.caseKey, secondPage.cases[0]!.caseKey])).toEqual(
      new Set([ownNovelId, searchNovelId]),
    );

    // A page past the end comes back empty rather than repeating the last one.
    const beyond = await listReportCases(queue({ page: 99 }));
    expect(beyond).toMatchObject({ page: 99, cases: [] });
  });
});
