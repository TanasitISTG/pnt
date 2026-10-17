import "@tanstack/react-start/server-only";

import { and, count, desc, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

import { recordAdminAction } from "@/lib/admin/audit.server";
import { getCommentAuthor, removeCommentForOperator } from "@/lib/comments/comment.service.server";
import { resolvePublicCover } from "@/lib/content/novel/cover-storage.server";
import { novelReadable, novelLive } from "@/lib/content/publish/publish";
import { db } from "@/lib/db";
import { chapters, comments, novels, reports, reviews, user } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { notifyReportsDecided, runNotificationWrite } from "@/lib/notifications/service.server";
import { getReviewAuthor, removeReviewForOperator } from "@/lib/reviews/review.service.server";
import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";

import { REPORT_CASE_DETAIL_LIMIT } from "./schemas";
import type {
  CreateCommentReportInput,
  CreateNovelReportInput,
  CreateReviewReportInput,
  RemoveReportedTargetInput,
  ReportQueueInput,
  ResolveReportCaseInput,
} from "./schemas";
import type {
  MyNovelReport,
  ReportCase,
  ReportCaseEntry,
  ReportCasePage,
  ReportCaseTarget,
  ReportHistoryPage,
} from "./types";

/**
 * Content reports, from the member who files one to the operator who decides it.
 *
 * Two shapes are worth naming. A *report* is one member's claim. A *case* is the
 * workload an operator actually works: every open report on the same target, grouped so
 * a single decision covers the pile and the decision is recorded once per report.
 *
 * Three targets exist. A case is keyed by the novel id, the comment id, or the review
 * id, except once the target has been deleted - then the report's own id keys it, because
 * there is nothing left to address. Every read of a case goes through `caseKeyOf` so all
 * three shapes are one thing to the queue.
 *
 * A decision never removes content. `removeReportedTargetForOperator` is the separate,
 * audited enforcement step an operator can take on a comment or review case.
 */

/**
 * The grouping key, per target. Only the column meant for the report's own target type is
 * populated (`novel_id`, `comment_id`, `review_id`), which is what keeps a comment case
 * from being folded into the novel it happens to live under. The fallback to the report id
 * keeps a case about deleted content addressable.
 */
const caseKeyOf = sql<string>`case
  when ${reports.targetType} = 'comment' then coalesce(${reports.commentId}, ${reports.id})
  when ${reports.targetType} = 'review' then coalesce(${reports.reviewId}, ${reports.id})
  else coalesce(${reports.novelId}, ${reports.id})
end`;

/**
 * Postgres hands an aggregate timestamp back as a Date, but a raw `sql` aggregate can
 * arrive as a string depending on the driver's type map; either shape becomes a Date so
 * paging and filtering never compare a string against a timestamp.
 */
function aggregateDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function targetFilter(target: ReportQueueInput["target"]) {
  return target === "all" ? undefined : eq(reports.targetType, target);
}

/**
 * The queue's search term, matched against what an operator can actually see in a row:
 * the novel's current title, the titles and words recorded when content was reported, and
 * the addresses of the accounts involved - the novel's owner for a novel case, the
 * author for a comment or review. Every branch is a correlated subquery, so the queue's
 * own reads stay join-free and keep their shape as targets are added.
 */
function searchFilter(q: string) {
  if (!q) return undefined;
  const term = `%${q}%`;
  const novelOwner = alias(user, "search_novel_owner");
  const commentAuthor = alias(user, "search_comment_author");
  const commentNovel = alias(novels, "search_comment_novel");
  const reviewAuthor = alias(user, "search_review_author");
  const reviewNovel = alias(novels, "search_review_novel");

  return or(
    ilike(reports.reportedNovelTitle, term),
    ilike(reports.reportedExcerpt, term),
    exists(
      db
        .select({ match: sql`1` })
        .from(novels)
        .leftJoin(novelOwner, eq(novelOwner.id, novels.userId))
        .where(
          and(
            eq(novels.id, reports.novelId),
            or(ilike(novels.title, term), ilike(novelOwner.email, term)),
          ),
        ),
    ),
    exists(
      db
        .select({ match: sql`1` })
        .from(comments)
        .leftJoin(commentAuthor, eq(commentAuthor.id, comments.userId))
        .leftJoin(commentNovel, eq(commentNovel.id, comments.novelId))
        .where(
          and(
            eq(comments.id, reports.commentId),
            or(
              ilike(comments.body, term),
              ilike(commentAuthor.email, term),
              ilike(commentNovel.title, term),
            ),
          ),
        ),
    ),
    exists(
      db
        .select({ match: sql`1` })
        .from(reviews)
        .leftJoin(reviewAuthor, eq(reviewAuthor.id, reviews.userId))
        .leftJoin(reviewNovel, eq(reviewNovel.id, reviews.novelId))
        .where(
          and(
            eq(reviews.id, reports.reviewId),
            or(
              ilike(reviews.body, term),
              ilike(reviewAuthor.email, term),
              ilike(reviewNovel.title, term),
            ),
          ),
        ),
    ),
  );
}

/**
 * Files one report against a novel, a comment, or a review. The duplicate message names
 * the target, because "for this novel" tells a reporter what the index refused and
 * "for this content" leaves them guessing which of three things they already filed.
 */
async function insertReport(
  values: typeof reports.$inferInsert,
  duplicateMessage: string,
): Promise<{ id: string }> {
  try {
    await db.insert(reports).values(values);
  } catch (error) {
    if (isUniqueViolation(error)) throw new SafeServerError(duplicateMessage);
    throw error;
  }
  return { id: values.id };
}

/**
 * Files one report against a novel.
 *
 * The novel has to be readable by the reporter - the same live/ownership rule every other
 * read uses, so a draft cannot be reported and does not leak its existence - and it must
 * not be their own: authors report content, they do not report themselves. Filing twice is
 * refused by the index rather than by a read-then-write race.
 */
export async function createNovelReportForUser(
  reporterId: string,
  input: CreateNovelReportInput,
): Promise<{ id: string; novelId: string; createdAt: Date }> {
  const [novel] = await db
    .select({ id: novels.id, userId: novels.userId, title: novels.title })
    .from(novels)
    .where(and(eq(novels.id, input.novelId), novelReadable(reporterId)))
    .limit(1);

  if (!novel) throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));
  if (novel.userId === reporterId) {
    throw new SafeServerError(encodeMessage("errors.ownNovelReport"));
  }

  const id = nanoid();
  await insertReport(
    {
      id,
      reporterUserId: reporterId,
      targetType: "novel",
      novelId: novel.id,
      reportedNovelTitle: novel.title,
      reportedUserId: novel.userId,
      reason: input.reason,
      details: input.details ?? null,
    },
    encodeMessage("errors.reportDuplicateNovel"),
  );

  return { id, novelId: novel.id, createdAt: new Date() };
}

/**
 * Files one report against a comment.
 *
 * The comment has to be readable: it follows its chapter's publication exactly as the
 * discussion does, so a comment on a draft cannot be reported and does not leak. A member
 * cannot report their own words, and the words are snapshotted with the parent novel's
 * title and its author so the case survives an edit or a delete.
 */
export async function createCommentReportForUser(
  reporterId: string,
  input: CreateCommentReportInput,
): Promise<{ id: string; commentId: string; createdAt: Date }> {
  const [comment] = await db
    .select({
      id: comments.id,
      userId: comments.userId,
      body: comments.body,
      novelId: comments.novelId,
      novelTitle: novels.title,
      novelOwnerId: novels.userId,
    })
    .from(comments)
    .innerJoin(novels, eq(novels.id, comments.novelId))
    .innerJoin(chapters, eq(chapters.id, comments.chapterId))
    .where(
      and(
        eq(comments.id, input.commentId),
        isNull(comments.removedAt),
        isNull(comments.deletedAt),
        novelReadable(reporterId),
        sql`${chapters.publishedAt} <= now()`,
        eq(chapters.status, "translated"),
      ),
    )
    .limit(1);

  if (!comment) throw new SafeServerError(encodeMessage("errors.commentNotFoundOrUnauthorized"));
  if (comment.userId === reporterId) {
    throw new SafeServerError(encodeMessage("errors.ownCommentReport"));
  }

  const id = nanoid();
  await insertReport(
    {
      id,
      reporterUserId: reporterId,
      targetType: "comment",
      commentId: comment.id,
      reportedNovelTitle: comment.novelTitle,
      reportedExcerpt: comment.body,
      reportedUserId: comment.userId ?? comment.novelOwnerId,
      reason: input.reason,
      details: input.details ?? null,
    },
    encodeMessage("errors.reportDuplicateComment"),
  );

  return { id, commentId: comment.id, createdAt: new Date() };
}

/**
 * Files one report against a review. The review has to be on a readable novel and still
 * live, and it cannot be the reporter's own; the words, the rating's novel title, and the
 * author are snapshotted the same way a novel report is.
 */
export async function createReviewReportForUser(
  reporterId: string,
  input: CreateReviewReportInput,
): Promise<{ id: string; reviewId: string; createdAt: Date }> {
  const [review] = await db
    .select({
      id: reviews.id,
      userId: reviews.userId,
      body: reviews.body,
      novelId: reviews.novelId,
      novelTitle: novels.title,
    })
    .from(reviews)
    .innerJoin(novels, eq(novels.id, reviews.novelId))
    .where(
      and(
        eq(reviews.id, input.reviewId),
        isNull(reviews.removedAt),
        novelReadable(reporterId),
        novelLive(),
      ),
    )
    .limit(1);

  if (!review) throw new SafeServerError(encodeMessage("errors.reviewNotFoundOrUnauthorized"));
  if (review.userId === reporterId) {
    throw new SafeServerError(encodeMessage("errors.ownReviewReport"));
  }

  const id = nanoid();
  await insertReport(
    {
      id,
      reporterUserId: reporterId,
      targetType: "review",
      reviewId: review.id,
      reportedNovelTitle: review.novelTitle,
      reportedExcerpt: review.body,
      reportedUserId: review.userId,
      reason: input.reason,
      details: input.details ?? null,
    },
    encodeMessage("errors.reportDuplicateReview"),
  );

  return { id, reviewId: review.id, createdAt: new Date() };
}

/**
 * The reporter's own open report on one novel. It exists so the novel page can show
 * "Reported" instead of offering a button whose call would fail on the unique index.
 * Comments and reviews carry the same answer inside their own list payloads.
 */
export async function getOpenNovelReportForUser(
  reporterId: string,
  novelId: string,
): Promise<MyNovelReport | null> {
  const [row] = await db
    .select({ id: reports.id, status: reports.status, createdAt: reports.createdAt })
    .from(reports)
    .where(
      and(
        eq(reports.reporterUserId, reporterId),
        eq(reports.novelId, novelId),
        eq(reports.status, "open"),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** The number of cases still needing a decision, for the operator tab. */
export async function countOpenReportCases(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(distinct ${caseKeyOf})`.mapWith(Number) })
    .from(reports)
    .where(eq(reports.status, "open"));

  return row?.value ?? 0;
}

interface GroupRow {
  caseKey: string;
  targetType: string;
  novelId: string | null;
  commentId: string | null;
  reviewId: string | null;
  titleSnapshot: string | null;
  excerptSnapshot: string | null;
  openCount: number;
  firstReportedAt: Date | string;
  lastReportedAt: Date | string;
  reasons: string[] | null;
}

interface TargetDetails {
  target: ReportCaseTarget;
  /** The reported account for the audit trail and the row's subtitle. */
  authorId: string | null;
}

/**
 * Resolves one group's target into what a row and a case dialog render. The target may be
 * gone; then the snapshots taken at report time stand in, and `deleted` tells the UI that
 * the link it would offer no longer leads anywhere.
 */
async function resolveTargets(groups: GroupRow[]): Promise<Map<string, TargetDetails>> {
  const commentAuthor = alias(user, "comment_author");
  const reviewAuthor = alias(user, "review_author");
  const novelIds = groups
    .filter((group) => group.targetType === "novel")
    .map((group) => group.novelId)
    .filter((id): id is string => id !== null);
  const commentIds = groups
    .filter((group) => group.targetType === "comment")
    .map((group) => group.commentId)
    .filter((id): id is string => id !== null);
  const reviewIds = groups
    .filter((group) => group.targetType === "review")
    .map((group) => group.reviewId)
    .filter((id): id is string => id !== null);

  const [novelRows, commentRows, reviewRows] = await Promise.all([
    novelIds.length
      ? db
          .select({
            id: novels.id,
            title: novels.title,
            publishedAt: novels.publishedAt,
            coverKey: novels.coverKey,
            ownerId: novels.userId,
            ownerName: user.name,
            ownerEmail: user.email,
          })
          .from(novels)
          .leftJoin(user, eq(user.id, novels.userId))
          .where(inArray(novels.id, novelIds))
      : Promise.resolve([]),
    commentIds.length
      ? db
          .select({
            id: comments.id,
            body: comments.body,
            removedAt: comments.removedAt,
            chapterId: chapters.id,
            chapterNumber: chapters.number,
            chapterTitle: chapters.title,
            novelId: novels.id,
            novelTitle: novels.title,
            publishedAt: novels.publishedAt,
            coverKey: novels.coverKey,
            authorId: comments.userId,
            authorName: commentAuthor.name,
            authorEmail: commentAuthor.email,
          })
          .from(comments)
          .innerJoin(chapters, eq(chapters.id, comments.chapterId))
          .innerJoin(novels, eq(novels.id, comments.novelId))
          .leftJoin(commentAuthor, eq(commentAuthor.id, comments.userId))
          .where(inArray(comments.id, commentIds))
      : Promise.resolve([]),
    reviewIds.length
      ? db
          .select({
            id: reviews.id,
            rating: reviews.rating,
            body: reviews.body,
            removedAt: reviews.removedAt,
            novelId: novels.id,
            novelTitle: novels.title,
            publishedAt: novels.publishedAt,
            coverKey: novels.coverKey,
            authorId: reviews.userId,
            authorName: reviewAuthor.name,
            authorEmail: reviewAuthor.email,
          })
          .from(reviews)
          .innerJoin(novels, eq(novels.id, reviews.novelId))
          .leftJoin(reviewAuthor, eq(reviewAuthor.id, reviews.userId))
          .where(inArray(reviews.id, reviewIds))
      : Promise.resolve([]),
  ]);

  const novelById = new Map(novelRows.map((row) => [row.id, row]));
  const commentById = new Map(commentRows.map((row) => [row.id, row]));
  const reviewById = new Map(reviewRows.map((row) => [row.id, row]));
  const resolved = new Map<string, TargetDetails>();

  for (const group of groups) {
    const empty: ReportCaseTarget = {
      type:
        group.targetType === "comment"
          ? "comment"
          : group.targetType === "review"
            ? "review"
            : "novel",
      novelId: group.novelId,
      title: group.titleSnapshot ?? "A deleted novel",
      publishedAt: null,
      coverUrl: null,
      coverSrcSet: null,
      ownerId: null,
      ownerName: null,
      ownerEmail: null,
      excerpt: group.excerptSnapshot,
      authorId: null,
      authorName: null,
      authorEmail: null,
      rating: null,
      chapterId: null,
      chapterNumber: null,
      chapterTitle: null,
      removedAt: null,
      deleted: true,
    };

    if (group.targetType === "novel") {
      const novel = group.novelId ? novelById.get(group.novelId) : undefined;
      const cover = novel ? resolvePublicCover(novel.coverKey, novel.publishedAt) : null;
      resolved.set(group.caseKey, {
        target: {
          ...empty,
          novelId: novel?.id ?? null,
          // A deleted novel keeps the title it had when it was reported.
          title: novel?.title ?? group.titleSnapshot ?? "A deleted novel",
          publishedAt: novel?.publishedAt ?? null,
          coverUrl: cover?.url ?? null,
          coverSrcSet: cover?.srcSet ?? null,
          ownerId: novel?.ownerId ?? null,
          ownerName: novel?.ownerName ?? null,
          ownerEmail: novel?.ownerEmail ?? null,
          deleted: !novel,
        },
        authorId: novel?.ownerId ?? null,
      });
      continue;
    }

    if (group.targetType === "comment") {
      const comment = group.commentId ? commentById.get(group.commentId) : undefined;
      const cover = comment ? resolvePublicCover(comment.coverKey, comment.publishedAt) : null;
      resolved.set(group.caseKey, {
        target: {
          ...empty,
          novelId: comment?.novelId ?? null,
          title: comment?.novelTitle ?? group.titleSnapshot ?? "A deleted novel",
          publishedAt: comment?.publishedAt ?? null,
          coverUrl: cover?.url ?? null,
          coverSrcSet: cover?.srcSet ?? null,
          ownerId: null,
          ownerName: null,
          ownerEmail: null,
          // The body may be gone (an author tombstone); the snapshot carries what was reported.
          excerpt: comment?.body ?? group.excerptSnapshot,
          authorId: comment?.authorId ?? null,
          authorName: comment?.authorName ?? null,
          authorEmail: comment?.authorEmail ?? null,
          chapterId: comment?.chapterId ?? null,
          chapterNumber: comment ? Number(comment.chapterNumber) : null,
          chapterTitle: comment?.chapterTitle ?? null,
          removedAt: comment?.removedAt ?? null,
          deleted: !comment,
        },
        authorId: comment?.authorId ?? null,
      });
      continue;
    }

    const review = group.reviewId ? reviewById.get(group.reviewId) : undefined;
    const cover = review ? resolvePublicCover(review.coverKey, review.publishedAt) : null;
    resolved.set(group.caseKey, {
      target: {
        ...empty,
        novelId: review?.novelId ?? null,
        title: review?.novelTitle ?? group.titleSnapshot ?? "A deleted novel",
        publishedAt: review?.publishedAt ?? null,
        coverUrl: cover?.url ?? null,
        coverSrcSet: cover?.srcSet ?? null,
        excerpt: review?.body ?? group.excerptSnapshot,
        authorId: review?.authorId ?? null,
        authorName: review?.authorName ?? null,
        authorEmail: review?.authorEmail ?? null,
        rating: review?.rating ?? null,
        removedAt: review?.removedAt ?? null,
        deleted: !review,
      },
      authorId: review?.authorId ?? null,
    });
  }

  return resolved;
}

/**
 * The open queue, newest work grouped per target and ordered longest-waiting first: a
 * moderation queue is a queue, and the case that has been open longest is the one whose
 * reporter has been waiting longest.
 *
 * The page is assembled in three reads - the aggregated cases, the targets they point at,
 * and the individual reports - because each wants a different shape: grouping for the
 * counts, exact rows for the target, and one row per reporter for the case file.
 */
export async function listReportCases(input: ReportQueueInput): Promise<ReportCasePage> {
  const where = and(eq(reports.status, "open"), targetFilter(input.target), searchFilter(input.q));

  const [totals, groups] = await Promise.all([
    db
      .select({ value: sql<number>`count(distinct ${caseKeyOf})`.mapWith(Number) })
      .from(reports)
      .where(where),
    db
      .select({
        caseKey: caseKeyOf,
        targetType: reports.targetType,
        novelId: reports.novelId,
        commentId: reports.commentId,
        reviewId: reports.reviewId,
        titleSnapshot: sql<string | null>`max(${reports.reportedNovelTitle})`,
        excerptSnapshot: sql<string | null>`max(${reports.reportedExcerpt})`,
        openCount: count(),
        firstReportedAt: sql<Date | string>`min(${reports.createdAt})`,
        lastReportedAt: sql<Date | string>`max(${reports.createdAt})`,
        reasons: sql<string[]>`array_agg(distinct ${reports.reason})`,
      })
      .from(reports)
      .where(where)
      // `caseKeyOf` already determines the target columns, but Postgres still requires
      // every selected column to be grouped, even the ones its key determines.
      .groupBy(caseKeyOf, reports.targetType, reports.novelId, reports.commentId, reports.reviewId)
      .orderBy(sql`min(${reports.createdAt})`)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
  ]);

  const caseKeys = groups.map((group) => group.caseKey);
  const [targets, detailRows] = await Promise.all([
    resolveTargets(groups),
    caseKeys.length
      ? db
          .select({
            caseKey: caseKeyOf,
            id: reports.id,
            reporterUserId: reports.reporterUserId,
            reporterEmail: user.email,
            reason: reports.reason,
            details: reports.details,
            createdAt: reports.createdAt,
          })
          .from(reports)
          .leftJoin(user, eq(user.id, reports.reporterUserId))
          .where(and(eq(reports.status, "open"), inArray(caseKeyOf, caseKeys)))
          .orderBy(desc(reports.createdAt))
      : Promise.resolve([]),
  ]);

  const entriesByCase = new Map<string, ReportCaseEntry[]>();
  for (const row of detailRows) {
    const entries = entriesByCase.get(row.caseKey) ?? [];
    entries.push({
      id: row.id,
      reporterUserId: row.reporterUserId,
      reporterEmail: row.reporterEmail,
      reason: row.reason,
      details: row.details,
      createdAt: row.createdAt,
    });
    entriesByCase.set(row.caseKey, entries);
  }

  const cases: ReportCase[] = groups.map((group) => {
    const resolved = targets.get(group.caseKey);
    const allEntries = entriesByCase.get(group.caseKey) ?? [];

    return {
      caseKey: group.caseKey,
      target: resolved?.target ?? {
        type: "novel",
        novelId: null,
        title: group.titleSnapshot ?? "A deleted target",
        publishedAt: null,
        coverUrl: null,
        coverSrcSet: null,
        ownerId: null,
        ownerName: null,
        ownerEmail: null,
        excerpt: group.excerptSnapshot,
        authorId: null,
        authorName: null,
        authorEmail: null,
        rating: null,
        chapterId: null,
        chapterNumber: null,
        chapterTitle: null,
        removedAt: null,
        deleted: true,
      },
      openCount: group.openCount,
      reasons: group.reasons ?? [],
      firstReportedAt: aggregateDate(group.firstReportedAt),
      lastReportedAt: aggregateDate(group.lastReportedAt),
      entries: allEntries.slice(0, REPORT_CASE_DETAIL_LIMIT),
      truncated: group.openCount > allEntries.length,
    };
  });

  return { cases, rowCount: totals[0]?.value ?? 0, page: input.page, pageSize: input.pageSize };
}

/**
 * Decided cases, newest decision first. A report carries the reporter's words, so this
 * list is itself sensitive: it is only ever read behind `ensureAdminSession`.
 */
export async function listReportHistory(input: ReportQueueInput): Promise<ReportHistoryPage> {
  const where = and(
    sql`${reports.status} <> 'open'`,
    targetFilter(input.target),
    searchFilter(input.q),
  );

  const [rows, totals] = await Promise.all([
    db
      .select({
        id: reports.id,
        caseKey: caseKeyOf,
        targetType: reports.targetType,
        novelId: reports.novelId,
        novelTitle: sql<string | null>`coalesce(${novels.title}, ${reports.reportedNovelTitle})`,
        excerpt: reports.reportedExcerpt,
        reason: reports.reason,
        details: reports.details,
        reporterEmail: user.email,
        status: reports.status,
        resolutionNote: reports.resolutionNote,
        resolvedByEmail: reports.resolvedByEmail,
        resolvedAt: reports.resolvedAt,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .leftJoin(novels, eq(novels.id, reports.novelId))
      .leftJoin(user, eq(user.id, reports.reporterUserId))
      .where(where)
      .orderBy(desc(reports.resolvedAt), desc(reports.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(reports).where(where),
  ]);

  return { rows, rowCount: totals[0]?.value ?? 0, page: input.page, pageSize: input.pageSize };
}

/**
 * Decides a case: every open report on it moves to the same verdict in one statement, so
 * the pile cannot be half-closed by a retry, and a second operator acting on the same
 * case races to zero rows and is told it was already decided rather than silently
 * rewriting someone else's note.
 *
 * The decision is a note and a status; it never suspends, unpublishes, removes, or
 * deletes anything. Enforcement stays a separate, deliberate action - for a comment or a
 * review that is `removeReportedTarget`.
 */
export async function resolveReportCaseForOperator(
  actor: { id: string; email: string | null },
  input: ResolveReportCaseInput,
): Promise<{ resolvedCount: number; novelId: string | null }> {
  const now = new Date();

  const resolved = await db
    .update(reports)
    .set({
      status: input.decision,
      resolutionNote: input.note ?? null,
      resolvedById: actor.id,
      resolvedByEmail: actor.email,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(reports.status, "open"),
        or(
          eq(reports.novelId, input.caseKey),
          eq(reports.commentId, input.caseKey),
          eq(reports.reviewId, input.caseKey),
          eq(reports.id, input.caseKey),
        ),
      ),
    )
    .returning({
      id: reports.id,
      reporterUserId: reports.reporterUserId,
      targetType: reports.targetType,
      novelId: reports.novelId,
      commentId: reports.commentId,
      reviewId: reports.reviewId,
      reportedUserId: reports.reportedUserId,
      reportedNovelTitle: reports.reportedNovelTitle,
    });

  if (resolved.length === 0) {
    throw new SafeServerError(encodeMessage("errors.reportCaseDecided"));
  }

  const first = resolved[0]!;
  const ownerId = resolved.find((row) => row.reportedUserId)?.reportedUserId ?? null;
  const owner = ownerId
    ? ((
        await db.select({ email: user.email }).from(user).where(eq(user.id, ownerId)).limit(1)
      )[0] ?? null)
    : null;

  await recordAdminAction({
    actorId: actor.id,
    actorEmail: actor.email,
    action: input.decision === "upheld" ? "report.upheld" : "report.dismissed",
    targetUserId: ownerId,
    targetEmail: owner?.email ?? null,
    detail: {
      targetType: first.targetType,
      targetId: first.commentId ?? first.reviewId ?? first.novelId ?? first.id,
      novelId: first.novelId,
      novelTitle: first.reportedNovelTitle,
      reports: resolved.length,
    },
  });

  // Each reporter filed their own claim, so each is told once. The decision is already
  // recorded and audited; a missing courtesy never makes the operator's action look failed.
  await runNotificationWrite("report decided", () =>
    notifyReportsDecided(resolved, input.decision, actor.id),
  );

  return { resolvedCount: resolved.length, novelId: first.novelId };
}

/**
 * The operator's enforcement step, deliberately separate from the decision above.
 *
 * Only comments and reviews can be removed here: a novel is unpublished or deleted
 * through its own owner controls, and pretending a queue button does that would be worse
 * than saying so. The case stays open afterwards, so the operator can still record why.
 */
export async function removeReportedTargetForOperator(
  actor: { id: string; email: string | null },
  input: RemoveReportedTargetInput,
): Promise<{ removed: boolean; targetType: string }> {
  const [report] = await db
    .select({
      id: reports.id,
      targetType: reports.targetType,
      novelId: reports.novelId,
      commentId: reports.commentId,
      reviewId: reports.reviewId,
      reportedNovelTitle: reports.reportedNovelTitle,
    })
    .from(reports)
    .where(
      or(
        eq(reports.novelId, input.caseKey),
        eq(reports.commentId, input.caseKey),
        eq(reports.reviewId, input.caseKey),
        eq(reports.id, input.caseKey),
      ),
    )
    .orderBy(desc(reports.createdAt))
    .limit(1);

  if (!report) throw new SafeServerError(encodeMessage("errors.reportCaseMissing"));

  if (report.targetType === "comment") {
    if (!report.commentId) throw new SafeServerError(encodeMessage("errors.commentAlreadyDeleted"));
    const author = await getCommentAuthor(report.commentId);
    const removed = await removeCommentForOperator(actor, report.commentId, input.reason);
    if (!removed) throw new SafeServerError(encodeMessage("errors.commentAlreadyRemoved"));
    await recordAdminAction({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "comment.removed",
      targetUserId: author?.userId ?? null,
      targetEmail: author?.email ?? null,
      detail: {
        commentId: report.commentId,
        novelId: author?.novelId ?? report.novelId,
        novelTitle: report.reportedNovelTitle,
      },
    });
    return { removed: true, targetType: "comment" };
  }

  if (report.targetType === "review") {
    if (!report.reviewId) throw new SafeServerError(encodeMessage("errors.reviewAlreadyDeleted"));
    const author = await getReviewAuthor(report.reviewId);
    const removed = await removeReviewForOperator(actor, report.reviewId, input.reason);
    if (!removed) throw new SafeServerError(encodeMessage("errors.reviewAlreadyRemoved"));
    await recordAdminAction({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "review.removed",
      targetUserId: author?.userId ?? null,
      targetEmail: author?.email ?? null,
      detail: {
        reviewId: report.reviewId,
        novelId: author?.novelId ?? report.novelId,
        novelTitle: report.reportedNovelTitle,
      },
    });
    return { removed: true, targetType: "review" };
  }

  throw new SafeServerError(encodeMessage("errors.reportTargetNotRemovable"));
}
