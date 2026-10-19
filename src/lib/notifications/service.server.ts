import "@tanstack/react-start/server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notExists,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { nanoid } from "@/lib/utils";
import { novelLive } from "@/lib/content/publish/publish";
import { chapters, comments, notifications, novelFollows, novels, reviews } from "@/lib/db/schema";
import type { NotificationMessage } from "./channels";
import { publishNotifications } from "./realtime.server";
import {
  NOTIFICATION_EXCERPT_MAX_LENGTH,
  NOTIFICATION_LIST_SIZE,
  type NotificationItem,
  type NotificationPage,
  type ReportOutcome,
} from "./types";

/**
 * Reading notifications, and writing them.
 *
 * The row is the record: every write below commits rows first and asks Ably afterwards, so a
 * socket that is down, unconfigured, or slow costs a live badge and never a notification. A
 * write is deliberately allowed to throw, because the caller decides whether a missing
 * courtesy may fail its own mutation — `src/lib/content/publish/` and the comment and report
 * services call these from `runNotificationWrite`, which logs and moves on.
 *
 * The one invariant worth knowing: a `chapter_published` row exists only while the chapter it
 * names is live. Publishing reconciles forward (the sweep and the eager event write rows),
 * unpublishing reconciles backward (the publish service clears them), so a bell never points
 * at a 404 and a republished chapter notifies again.
 */

/** One round trip per this many followers; a very large follow list still fits one request. */
const FOLLOW_BATCH_SIZE = 1000;

/** How far back the sweep looks for a chapter that went live without an eager fan-out. */
const SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Chapters the sweep will fan out in one run, so a backlog cannot monopolize a cron. */
const SWEEP_CHAPTER_LIMIT = 50;

/** The two retention windows: read rows go sooner than the ones nobody has looked at. */
const READ_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const UNREAD_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/** Rows one prune run may remove, so the delete never holds a wide lock. */
const PRUNE_BATCH_SIZE = 5000;

type NotificationRow = {
  id: string;
  userId: string;
  kind: "chapter_published" | "comment_reply" | "novel_comment" | "novel_review" | "report_decided";
  novelId: string | null;
  chapterId: string | null;
  commentId: string | null;
  reportId: string | null;
  novelTitle: string;
  detail: string | null;
  outcome: string | null;
  createdAt: Date;
  readAt: Date | null;
};

function toOutcome(value: string | null): ReportOutcome | null {
  return value === "upheld" || value === "dismissed" ? value : null;
}

function toItem(row: NotificationRow & { chapterTitle?: string | null }): NotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    novelId: row.novelId,
    chapterId: row.chapterId,
    commentId: row.commentId,
    reportId: row.reportId,
    novelTitle: row.novelTitle,
    chapterTitle: row.chapterTitle ?? null,
    detail: row.detail,
    outcome: toOutcome(row.outcome),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

function toMessage(row: NotificationRow): NotificationMessage {
  return { ...toItem(row), userId: row.userId, outcome: toOutcome(row.outcome) };
}

/** The columns every notification read returns, so the shapes cannot drift apart. */
const notificationColumns = {
  id: notifications.id,
  userId: notifications.userId,
  kind: notifications.kind,
  novelId: notifications.novelId,
  chapterId: notifications.chapterId,
  commentId: notifications.commentId,
  reportId: notifications.reportId,
  novelTitle: notifications.novelTitle,
  detail: notifications.detail,
  outcome: notifications.outcome,
  createdAt: notifications.createdAt,
  readAt: notifications.readAt,
};

/**
 * Writes one notification and announces it, returning null when the dedupe key says it was
 * already delivered. The single-row writers share this so a new kind cannot forget either
 * half — the conflict target or the publish.
 */
async function insertOne(
  value: typeof notifications.$inferInsert,
): Promise<NotificationRow | null> {
  const [row] = await db
    .insert(notifications)
    .values(value)
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning(notificationColumns);

  if (!row) return null;

  await publishNotifications([toMessage(row)]);
  return row;
}

function excerptOf(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= NOTIFICATION_EXCERPT_MAX_LENGTH) return collapsed;
  return `${collapsed.slice(0, NOTIFICATION_EXCERPT_MAX_LENGTH - 1)}…`;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

/**
 * Runs a notification write without letting it decide the fate of the mutation that caused
 * it. Every caller is a publish, a comment, or a decision that already succeeded; the reader
 * can lose a badge, but never the thing they did.
 */
export async function runNotificationWrite(
  label: string,
  write: () => Promise<unknown>,
): Promise<void> {
  try {
    await write();
  } catch (error: unknown) {
    log("warn", `notification write failed: ${label}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The bell's read: the newest rows and the unread count beside them. */
export async function listNotificationsForUser(userId: string): Promise<NotificationPage> {
  const [rows, unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        kind: notifications.kind,
        novelId: notifications.novelId,
        chapterId: notifications.chapterId,
        commentId: notifications.commentId,
        reportId: notifications.reportId,
        novelTitle: notifications.novelTitle,
        chapterTitle: sql<string | null>`coalesce(${chapters.translatedTitle}, ${chapters.title})`,
        detail: notifications.detail,
        outcome: notifications.outcome,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .leftJoin(chapters, eq(notifications.chapterId, chapters.id))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(NOTIFICATION_LIST_SIZE),
    db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);

  return { items: rows.map(toItem), unreadCount: unread[0]?.value ?? 0 };
}

/**
 * Marks the named notifications read, or every unread one when no ids are given. Only the
 * caller's own rows can move, so a leaked id is inert.
 */
export async function markNotificationsReadForUser(
  userId: string,
  ids?: readonly string[],
): Promise<{ unreadCount: number }> {
  const unreadOfUser = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  const target =
    ids && ids.length > 0 ? and(unreadOfUser, inArray(notifications.id, ids)) : unreadOfUser;

  await db.update(notifications).set({ readAt: new Date() }).where(target);

  const [unread] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

  return { unreadCount: unread?.value ?? 0 };
}

/**
 * Fans a live chapter out to its novel's followers, excluding the author, and asks Ably to
 * announce it. Idempotent: the unique `(user_id, dedupe_key)` index makes a second run insert
 * nothing, so the sweep can retry without ever notifying twice.
 *
 * A chapter that is not live yet returns 0 instead of writing rows: scheduled publishing has
 * no request behind it, and the sweep is what turns the clock into the event.
 */
export async function notifyChapterPublished(chapterId: string): Promise<number> {
  const now = new Date();
  const [chapter] = await db
    .select({
      id: chapters.id,
      novelId: chapters.novelId,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
      publishedAt: chapters.publishedAt,
      novelTitle: novels.title,
      ownerId: novels.userId,
      novelPublishedAt: novels.publishedAt,
    })
    .from(chapters)
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(eq(chapters.id, chapterId))
    .limit(1);

  if (!chapter) return 0;
  if (!chapter.publishedAt || chapter.publishedAt > now) return 0;
  if (!chapter.novelPublishedAt || chapter.novelPublishedAt > now) return 0;

  const followers = await db
    .select({ userId: novelFollows.userId })
    .from(novelFollows)
    .where(
      and(
        eq(novelFollows.novelId, chapter.novelId),
        sql`${novelFollows.userId} <> ${chapter.ownerId}`,
      ),
    )
    .orderBy(asc(novelFollows.userId));

  if (followers.length === 0) return 0;

  const detail = chapter.translatedTitle || chapter.title || null;
  const created: NotificationRow[] = [];

  for (const batch of chunks(followers, FOLLOW_BATCH_SIZE)) {
    const inserted = await db
      .insert(notifications)
      .values(
        batch.map((follower) => ({
          id: nanoid(),
          userId: follower.userId,
          kind: "chapter_published" as const,
          dedupeKey: `chapter:${chapter.id}`,
          novelId: chapter.novelId,
          chapterId: chapter.id,
          novelTitle: chapter.novelTitle,
          detail,
        })),
      )
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .returning({
        id: notifications.id,
        userId: notifications.userId,
        kind: notifications.kind,
        novelId: notifications.novelId,
        chapterId: notifications.chapterId,
        commentId: notifications.commentId,
        reportId: notifications.reportId,
        novelTitle: notifications.novelTitle,
        detail: notifications.detail,
        outcome: notifications.outcome,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      });

    created.push(...inserted);
  }

  await publishNotifications(created.map(toMessage));
  return created.length;
}

/**
 * Tells a comment's parent author that someone replied. The excerpt is snapshotted because
 * the reply can be edited or deleted afterwards; the author is not named, so a renamed or
 * deleted account cannot leave a stale name behind.
 */
export async function notifyCommentReply(commentId: string): Promise<number> {
  const [reply] = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      userId: comments.userId,
      body: comments.body,
      novelId: comments.novelId,
      chapterId: comments.chapterId,
      novelTitle: novels.title,
    })
    .from(comments)
    .innerJoin(novels, eq(comments.novelId, novels.id))
    .where(eq(comments.id, commentId))
    .limit(1);

  if (!reply || !reply.parentId || !reply.userId || !reply.body) return 0;

  const [parent] = await db
    .select({ userId: comments.userId, removedAt: comments.removedAt })
    .from(comments)
    .where(eq(comments.id, reply.parentId))
    .limit(1);

  // A reply to one's own comment is not news, a deleted parent has nobody to tell, and a
  // removed parent is not a thread the author should be pulled back into.
  if (!parent?.userId || parent.userId === reply.userId || parent.removedAt) return 0;

  // The dedupe key carries the kind, so one comment can produce a reply notice for its
  // parent's author and an owner notice for its novel without the two colliding.
  const row = await insertOne({
    id: nanoid(),
    userId: parent.userId,
    kind: "comment_reply",
    dedupeKey: `comment_reply:${reply.id}`,
    novelId: reply.novelId,
    chapterId: reply.chapterId,
    commentId: reply.id,
    novelTitle: reply.novelTitle,
    detail: excerptOf(reply.body),
  });

  return row ? 1 : 0;
}

/**
 * Tells a novel's owner that someone commented on one of its chapters.
 *
 * Top-level comments only: a reply is a conversation with the parent's author, who is
 * already told, and the owner would otherwise hear both sides of every thread on their
 * novel. Their own comment is not news either.
 */
export async function notifyNovelComment(commentId: string): Promise<number> {
  const [comment] = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      userId: comments.userId,
      body: comments.body,
      novelId: comments.novelId,
      chapterId: comments.chapterId,
      novelTitle: novels.title,
      ownerId: novels.userId,
    })
    .from(comments)
    .innerJoin(novels, eq(comments.novelId, novels.id))
    .where(eq(comments.id, commentId))
    .limit(1);

  if (!comment || comment.parentId || !comment.body) return 0;
  if (!comment.userId || comment.userId === comment.ownerId) return 0;

  const row = await insertOne({
    id: nanoid(),
    userId: comment.ownerId,
    kind: "novel_comment",
    dedupeKey: `novel_comment:${comment.id}`,
    novelId: comment.novelId,
    chapterId: comment.chapterId,
    commentId: comment.id,
    novelTitle: comment.novelTitle,
    detail: excerptOf(comment.body),
  });

  return row ? 1 : 0;
}

/**
 * Tells a novel's owner that someone reviewed it.
 *
 * The dedupe key is the review's id, so editing a review later notifies nobody: the owner
 * already heard about it, and a re-save is not a new event. A rating-only review still
 * notifies — the words are optional, the signal is not.
 */
export async function notifyNovelReview(reviewId: string): Promise<number> {
  const [review] = await db
    .select({
      id: reviews.id,
      userId: reviews.userId,
      body: reviews.body,
      removedAt: reviews.removedAt,
      novelId: reviews.novelId,
      novelTitle: novels.title,
      ownerId: novels.userId,
    })
    .from(reviews)
    .innerJoin(novels, eq(reviews.novelId, novels.id))
    .where(eq(reviews.id, reviewId))
    .limit(1);

  if (!review || review.removedAt) return 0;
  if (review.userId === review.ownerId) return 0;

  const row = await insertOne({
    id: nanoid(),
    userId: review.ownerId,
    kind: "novel_review",
    dedupeKey: `novel_review:${review.id}`,
    novelId: review.novelId,
    commentId: null,
    novelTitle: review.novelTitle,
    detail: review.body ? excerptOf(review.body) : null,
  });

  return row ? 1 : 0;
}

export interface DecidedReport {
  id: string;
  reporterUserId: string;
  novelId: string | null;
  reportedNovelTitle: string | null;
}

/**
 * Tells every reporter whose claim was in a decided case what the decision was. One row per
 * report, not per case, because each reporter filed their own claim and each is told once;
 * the operator who decided it is skipped if they happen to have filed one too.
 */
export async function notifyReportsDecided(
  resolved: readonly DecidedReport[],
  outcome: ReportOutcome,
  actorId: string,
): Promise<number> {
  const recipients = resolved.filter((report) => report.reporterUserId !== actorId);
  if (recipients.length === 0) return 0;

  const created = await db
    .insert(notifications)
    .values(
      recipients.map((report) => ({
        id: nanoid(),
        userId: report.reporterUserId,
        kind: "report_decided" as const,
        dedupeKey: `report:${report.id}`,
        novelId: report.novelId,
        reportId: report.id,
        // A report can name a target whose title was never captured; the sentence then
        // reads without it rather than inventing one.
        novelTitle: report.reportedNovelTitle ?? "",
        outcome,
      })),
    )
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning({
      id: notifications.id,
      userId: notifications.userId,
      kind: notifications.kind,
      novelId: notifications.novelId,
      chapterId: notifications.chapterId,
      commentId: notifications.commentId,
      reportId: notifications.reportId,
      novelTitle: notifications.novelTitle,
      detail: notifications.detail,
      outcome: notifications.outcome,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    });

  await publishNotifications(created.map(toMessage));
  return created.length;
}

/**
 * Removes the chapter notifications a publication change invalidated. Called when a chapter
 * or its novel stops being live — including a reschedule into the future, where the rows
 * would otherwise announce a chapter the catalog no longer shows.
 */
export async function clearChapterNotifications(chapterId: string): Promise<number> {
  const removed = await db
    .delete(notifications)
    .where(and(eq(notifications.kind, "chapter_published"), eq(notifications.chapterId, chapterId)))
    .returning({ id: notifications.id });
  return removed.length;
}

export async function clearNovelNotifications(novelId: string): Promise<number> {
  const removed = await db
    .delete(notifications)
    .where(and(eq(notifications.kind, "chapter_published"), eq(notifications.novelId, novelId)))
    .returning({ id: notifications.id });
  return removed.length;
}

/**
 * The clock's half of publishing: chapters that went live without an eager fan-out (a
 * scheduled publication has no request behind it) and chapters whose event was lost.
 *
 * The lookback is bounded because the rows it would create are already covered by the
 * unique dedupe key: a missed run self-heals on the next one, and a very old chapter that
 * nobody was following at the time does not suddenly announce itself.
 */
export async function sweepPendingChapterNotifications(): Promise<{
  chapters: number;
  notifications: number;
}> {
  const now = new Date();
  const since = new Date(now.getTime() - SWEEP_LOOKBACK_MS);

  const pending = await db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(
      and(
        isNotNull(chapters.publishedAt),
        lte(chapters.publishedAt, now),
        gte(chapters.publishedAt, since),
        novelLive(now),
        exists(
          db
            .select({ value: sql`1` })
            .from(novelFollows)
            .where(eq(novelFollows.novelId, chapters.novelId)),
        ),
        notExists(
          db
            .select({ value: sql`1` })
            .from(notifications)
            .where(
              and(
                eq(notifications.kind, "chapter_published"),
                eq(notifications.chapterId, chapters.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(chapters.publishedAt))
    .limit(SWEEP_CHAPTER_LIMIT);

  let written = 0;
  for (const chapter of pending) {
    written += await notifyChapterPublished(chapter.id);
  }

  return { chapters: pending.length, notifications: written };
}

/**
 * Retention. A bell is a recent-events surface, not an inbox with an archive, and every
 * chapter a reader follows would otherwise add a row that lives forever.
 */
export async function pruneNotifications(): Promise<number> {
  const readCutoff = new Date(Date.now() - READ_RETENTION_MS);
  const unreadCutoff = new Date(Date.now() - UNREAD_RETENTION_MS);

  const readRemoved = await db
    .delete(notifications)
    .where(
      inArray(
        notifications.id,
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(isNotNull(notifications.readAt), lt(notifications.readAt, readCutoff)))
          .limit(PRUNE_BATCH_SIZE),
      ),
    )
    .returning({ id: notifications.id });

  const unreadRemoved = await db
    .delete(notifications)
    .where(
      inArray(
        notifications.id,
        db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(isNull(notifications.readAt), lt(notifications.createdAt, unreadCutoff)))
          .limit(PRUNE_BATCH_SIZE),
      ),
    )
    .returning({ id: notifications.id });

  return readRemoved.length + unreadRemoved.length;
}
