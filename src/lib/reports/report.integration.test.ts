import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";

import { encodeMessage } from "@/lib/i18n/message-code";
import en from "@/lib/i18n/messages/en";
import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

import type { ReportQueueInput } from "./schemas";
import { REPORT_CASE_PAGE_SIZE } from "./schemas";

/**
 * The wire form of a refusal (i18n.md §3).
 *
 * Server copy is a key, not a sentence: the surface that reads it renders it in the
 * reader's own language, so the assertion pins the key rather than one language's wording.
 * Typing the argument against the catalog keeps a renamed key a compile error here instead
 * of a stored string nothing can resolve.
 */
function messageCode(key: keyof (typeof en)["errors"]): string {
  return encodeMessage(`errors.${key}`);
}

let sql: Sql;
/**
 * Imported in `beforeAll`, never at the top of the file: the service pulls in the pooled
 * database client, which binds `DATABASE_URL` when it is first imported. A static import
 * would bind the application database before the test could point the process at the
 * disposable one.
 */
let createNovelReportForUser: typeof import("./report.service.server").createNovelReportForUser;
let createCommentReportForUser: typeof import("./report.service.server").createCommentReportForUser;
let createReviewReportForUser: typeof import("./report.service.server").createReviewReportForUser;
let getOpenNovelReportForUser: typeof import("./report.service.server").getOpenNovelReportForUser;
let countOpenReportCases: typeof import("./report.service.server").countOpenReportCases;
let listReportCases: typeof import("./report.service.server").listReportCases;
let listReportHistory: typeof import("./report.service.server").listReportHistory;
let resolveReportCaseForOperator: typeof import("./report.service.server").resolveReportCaseForOperator;
let removeReportedTargetForOperator: typeof import("./report.service.server").removeReportedTargetForOperator;
let createCommentForUser: typeof import("@/lib/comments/comment.service.server").createCommentForUser;
let listChapterCommentsForViewer: typeof import("@/lib/comments/comment.service.server").listChapterCommentsForViewer;
let saveReviewForUser: typeof import("@/lib/reviews/review.service.server").saveReviewForUser;
let getNovelRatingForViewer: typeof import("@/lib/reviews/review.service.server").getNovelRatingForViewer;
let listNovelReviewsForViewer: typeof import("@/lib/reviews/review.service.server").listNovelReviewsForViewer;

let authorId: string;
let authorEmail: string;
let reporterId: string;
let reporterEmail: string;
let secondReporterId: string;
let secondReporterEmail: string;
let operatorId: string;
let operatorEmail: string;

let liveNovelId: string;
let liveChapterId: string;
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
  return {
    tab: "open",
    target: "all",
    q: "",
    page: 1,
    pageSize: REPORT_CASE_PAGE_SIZE,
    ...overrides,
  };
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

describeIntegration("novel reporting", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url, { connections: 10 }));
    ({
      createNovelReportForUser,
      createCommentReportForUser,
      createReviewReportForUser,
      getOpenNovelReportForUser,
      countOpenReportCases,
      listReportCases,
      listReportHistory,
      resolveReportCaseForOperator,
      removeReportedTargetForOperator,
    } = await import("./report.service.server"));
    ({ createCommentForUser, listChapterCommentsForViewer } =
      await import("@/lib/comments/comment.service.server"));
    ({ saveReviewForUser, getNovelRatingForViewer, listNovelReviewsForViewer } =
      await import("@/lib/reviews/review.service.server"));

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

    // A live, translated chapter on the first novel: comments can only be written on one,
    // and the report path follows the chapter's publication exactly as the discussion does.
    liveChapterId = `chapter-${randomUUID()}`;
    const now = new Date();
    await sql`
      INSERT INTO "chapters"
        ("id", "novel_id", "number", "title", "raw_content", "status", "raw_char_count", "published_at", "created_at", "updated_at")
      VALUES (${liveChapterId}, ${liveNovelId}, '1', 'Chapter One', 'raw text', 'translated', 8, ${timestamp(new Date(Date.now() - 3_600_000))}, ${timestamp(now)}, ${timestamp(now)})
    `;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM "reports" WHERE "reporter_user_id" IN (${reporterId}, ${secondReporterId})`;
    await sql`DELETE FROM "admin_audit_log" WHERE "actor_id" = ${operatorId}`;
    await sql`DELETE FROM "novels" WHERE "user_id" = ${authorId} OR "user_id" = ${reporterId}`;
    await sql`DELETE FROM "user" WHERE "id" IN (${authorId}, ${reporterId}, ${secondReporterId}, ${operatorId})`;
    await closeIntegrationDatabase();
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
    ).rejects.toThrow(encodeMessage("errors.reportDuplicateNovel"));

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
    ).rejects.toThrow(messageCode("novelNotFoundOrUnauthorized"));

    // A live novel of the reporter's own is readable, so this refusal is the self-report
    // rule rather than visibility: authors report content, they do not report themselves.
    await expect(
      createNovelReportForUser(reporterId, { novelId: ownNovelId, reason: "copyright" }),
    ).rejects.toThrow(messageCode("ownNovelReport"));
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
    expect(audit!.detail).toEqual({
      targetType: "novel",
      targetId: liveNovelId,
      novelId: liveNovelId,
      novelTitle: liveTitle,
      reports: 2,
    });

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
    ).rejects.toThrow(encodeMessage("errors.reportCaseDecided"));

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

  it("groups comment cases per comment and takes the reported words down on demand", async () => {
    const comment = await createCommentForUser(authorId, {
      chapterId: liveChapterId,
      body: "Chapter 12 spoilers ahead.",
    });
    const reply = await createCommentForUser(secondReporterId, {
      chapterId: liveChapterId,
      parentId: comment.id,
      body: "Thanks for the warning.",
    });

    // One level of replies, enforced where the row is written rather than by the reader.
    await expect(
      createCommentForUser(reporterId, {
        chapterId: liveChapterId,
        parentId: reply.id,
        body: "A reply to a reply.",
      }),
    ).rejects.toThrow(messageCode("replyToReply"));

    await createCommentReportForUser(reporterId, {
      commentId: comment.id,
      reason: "hate_or_harassment",
      details: "Targeted at another reader.",
    });
    const secondComment = await createCommentForUser(authorId, {
      chapterId: liveChapterId,
      body: "A second, unrelated comment.",
    });
    await createCommentReportForUser(reporterId, {
      commentId: secondComment.id,
      reason: "spam_or_scam",
    });

    // Authors do not report their own words, and the index refuses a repeat from the same
    // account on the same comment.
    await expect(
      createCommentReportForUser(authorId, { commentId: comment.id, reason: "spam_or_scam" }),
    ).rejects.toThrow(messageCode("ownCommentReport"));
    await expect(
      createCommentReportForUser(reporterId, {
        commentId: comment.id,
        reason: "other",
        details: "More.",
      }),
    ).rejects.toThrow(encodeMessage("errors.reportDuplicateComment"));

    const commentCases = await listReportCases(queue({ target: "comment" }));
    expect(commentCases.rowCount).toBe(2);
    const reportedCase = commentCases.cases.find((entry) => entry.caseKey === comment.id);
    expect(reportedCase?.target).toMatchObject({
      type: "comment",
      title: liveTitle,
      excerpt: "Chapter 12 spoilers ahead.",
      chapterNumber: 1,
      chapterId: liveChapterId,
      authorId,
      authorEmail,
      deleted: false,
    });
    expect(reportedCase?.target.novelId).toBe(liveNovelId);

    // A per-comment case is not folded into the novel's own case, and the novel filter
    // never returns a comment case.
    const novelCases = await listReportCases(queue({ target: "novel" }));
    expect(novelCases.cases.some((entry) => entry.caseKey === comment.id)).toBe(false);
    expect(novelCases.cases.every((entry) => entry.target.type === "novel")).toBe(true);

    // Removal is its own audited action, not the decision.
    const removal = await removeReportedTargetForOperator(
      { id: operatorId, email: operatorEmail },
      { caseKey: comment.id, reason: "Spoilers outside the spoiler window." },
    );
    expect(removal).toEqual({ removed: true, targetType: "comment" });

    const [removalAudit] = await sql<
      { action: string; target_user_id: string | null; detail: Record<string, unknown> }[]
    >`
      SELECT "action", "target_user_id", "detail" FROM "admin_audit_log"
      WHERE "actor_id" = ${operatorId} AND "action" = 'comment.removed'
    `;
    expect(removalAudit).toMatchObject({ action: "comment.removed", target_user_id: authorId });
    expect(removalAudit!.detail).toMatchObject({ commentId: comment.id, novelId: liveNovelId });

    // A second operator finds it already down rather than rewriting the note.
    await expect(
      removeReportedTargetForOperator(
        { id: operatorId, email: operatorEmail },
        { caseKey: comment.id, reason: "Again." },
      ),
    ).rejects.toThrow(encodeMessage("errors.commentAlreadyRemoved"));

    // Enforcement is per target: clearing one case leaves the words in another case alone.
    const secondRemoval = await removeReportedTargetForOperator(
      { id: operatorId, email: operatorEmail },
      { caseKey: secondComment.id, reason: "Advertises an unrelated service." },
    );
    expect(secondRemoval).toEqual({ removed: true, targetType: "comment" });

    // The words are gone for everyone but the author, and because the comment carries a
    // reply the thread stays readable - other readers' words are not collateral.
    const publicView = await listChapterCommentsForViewer(null, {
      chapterId: liveChapterId,
      page: 1,
    });
    const tombstone = publicView.threads.find((thread) => thread.id === comment.id);
    expect(tombstone?.removedAt).toBeInstanceOf(Date);
    expect(tombstone?.replies.map((entry) => entry.body)).toEqual(["Thanks for the warning."]);

    const authorView = await listChapterCommentsForViewer(authorId, {
      chapterId: liveChapterId,
      page: 1,
    });
    expect(authorView.threads.find((thread) => thread.id === comment.id)?.removalReason).toBe(
      "Spoilers outside the spoiler window.",
    );

    // The second comment has no replies, so there is no thread left to preserve: it is
    // gone from the public discussion entirely and survives only for its author.
    expect(publicView.threads.some((thread) => thread.id === secondComment.id)).toBe(false);
    const authorSecond = authorView.threads.find((thread) => thread.id === secondComment.id);
    expect(authorSecond?.removedAt).toBeInstanceOf(Date);
    expect(authorSecond?.removalReason).toBe("Advertises an unrelated service.");
  });

  it("takes a reported review down and drops its rating from the average", async () => {
    const review = await saveReviewForUser(secondReporterId, {
      novelId: liveNovelId,
      rating: 2,
      body: "The translation slips in chapter 3.",
    });

    const own = await saveReviewForUser(reporterId, { novelId: liveNovelId, rating: 5 });
    expect(own.id).toBeTruthy();
    expect(await getNovelRatingForViewer(null, liveNovelId)).toMatchObject({
      average: 3.5,
      count: 2,
    });

    // Authors rate other people's novels; the novel's owner is refused outright.
    await expect(saveReviewForUser(authorId, { novelId: liveNovelId, rating: 5 })).rejects.toThrow(
      messageCode("ownNovelReview"),
    );

    await createReviewReportForUser(reporterId, {
      reviewId: review.id,
      reason: "spam_or_scam",
      details: "A drive-by rating.",
    });

    const reviewCases = await listReportCases(queue({ target: "review" }));
    const reportedCase = reviewCases.cases.find((entry) => entry.caseKey === review.id);
    expect(reportedCase?.target).toMatchObject({
      type: "review",
      rating: 2,
      excerpt: "The translation slips in chapter 3.",
      authorEmail: secondReporterEmail,
      title: liveTitle,
    });

    await expect(
      createReviewReportForUser(reporterId, {
        reviewId: review.id,
        reason: "other",
        details: "Again.",
      }),
    ).rejects.toThrow(encodeMessage("errors.reportDuplicateReview"));

    const removal = await removeReportedTargetForOperator(
      { id: operatorId, email: operatorEmail },
      { caseKey: review.id, reason: "Rating manipulation." },
    );
    expect(removal).toEqual({ removed: true, targetType: "review" });

    // The removed rating leaves the average immediately, and the words leave the public
    // list while the author keeps a reason.
    expect(await getNovelRatingForViewer(null, liveNovelId)).toMatchObject({
      average: 5,
      count: 1,
    });
    const publicReviews = await listNovelReviewsForViewer(null, { novelId: liveNovelId, page: 1 });
    expect(publicReviews.reviews.some((row) => row.id === review.id)).toBe(false);
    const authorReviews = await listNovelReviewsForViewer(secondReporterId, {
      novelId: liveNovelId,
      page: 1,
    });
    expect(authorReviews.reviews.find((row) => row.id === review.id)?.removalReason).toBe(
      "Rating manipulation.",
    );

    const [reviewAudit] = await sql<{ action: string; target_user_id: string | null }[]>`
      SELECT "action", "target_user_id" FROM "admin_audit_log"
      WHERE "actor_id" = ${operatorId} AND "action" = 'review.removed'
    `;
    expect(reviewAudit).toMatchObject({
      action: "review.removed",
      target_user_id: secondReporterId,
    });
  });
});
