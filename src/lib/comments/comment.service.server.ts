import "@tanstack/react-start/server-only";

import { and, asc, count, desc, eq, exists, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { chapters, comments, novels, reports, user } from "@/lib/db/schema";
import { chapterVisibleToGuests, novelLive } from "@/lib/content/publish/publish";
import { resolveUserAvatar } from "@/lib/profile/avatar.server";
import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";
import { nanoid } from "@/lib/utils";

import {
  COMMENT_PAGE_SIZE,
  COMMENT_REPLY_FETCH_LIMIT,
  type CreateCommentInput,
  type ListChapterCommentsInput,
  type UpdateCommentInput,
} from "./schemas";
import type { ChapterComment, ChapterCommentPage, CommentThread } from "./types";

/**
 * Chapter comments, from the reader who writes one to the operator who removes it.
 *
 * Three visibility rules are applied together in one place, because the count, the page,
 * and the replies must agree:
 *  - a comment follows its chapter's publication: a draft or unpublished chapter has no
 *    readable discussion, for its owner included;
 *  - an operator-removed comment is gone for everyone except its author, who still sees
 *    it as removed with the reason - silently disappearing would leave them re-posting;
 *  - an author-deleted comment survives only as a tombstone while it has replies, so the
 *    thread it started keeps its context.
 *
 * Replies are one level deep: a reply's parent is always a top-level comment, enforced
 * when it is created, which is what lets the page fetch a bounded set of replies per
 * visible thread with a window function rather than a recursive query.
 */

/** Row shape shared by the top-level and reply reads. */
const commentColumns = {
  id: comments.id,
  parentId: comments.parentId,
  body: comments.body,
  createdAt: comments.createdAt,
  editedAt: comments.editedAt,
  deletedAt: comments.deletedAt,
  removedAt: comments.removedAt,
  removalReason: comments.removalReason,
  authorId: user.id,
  authorName: user.name,
  authorImage: user.image,
};

type CommentRow = {
  id: string;
  parentId: string | null;
  body: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  removedAt: Date | null;
  removalReason: string | null;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
};

/**
 * The reader-facing filter for a comment row.
 *
 * A removed comment stays visible as a tombstone whenever it carries replies - those
 * replies belong to other readers, and hiding their parent would take them away with it -
 * and otherwise only to its author, who is told why. An author-deleted tombstone follows
 * the same rule, and the delete path hard-deletes the ones with no replies, so an empty
 * shell cannot linger. `has_reply` is a correlated subquery rather than a join so the same
 * predicate serves the count and the page without changing the row shape.
 */
const replyComments = alias(comments, "reply");

function readableCommentFilter(viewerId: string | null) {
  const hasReply = exists(
    db
      .select({ match: sql`1` })
      .from(replyComments)
      .where(eq(replyComments.parentId, comments.id)),
  );
  const removal = viewerId
    ? or(isNull(comments.removedAt), eq(comments.userId, viewerId), hasReply)
    : or(isNull(comments.removedAt), hasReply);
  return and(removal, or(isNull(comments.deletedAt), hasReply));
}

function toAuthor(row: CommentRow) {
  return {
    id: row.authorId,
    name: row.authorName,
    avatar: row.authorId ? resolveUserAvatar(row.authorImage) : null,
  };
}

function toComment(
  row: CommentRow,
  viewerId: string | null,
  reportedIds: ReadonlySet<string>,
): ChapterComment {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    removedAt: row.removedAt,
    removalReason: row.removalReason,
    author: toAuthor(row),
    isOwn: viewerId !== null && row.authorId === viewerId,
    viewerReported: reportedIds.has(row.id),
  };
}

/** The chapter a comment belongs to, but only while it is live and translated. */
async function liveChapter(chapterId: string): Promise<{ id: string; novelId: string }> {
  const [chapter] = await db
    .select({ id: chapters.id, novelId: chapters.novelId })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapters.id, chapterId), chapterVisibleToGuests(), novelLive()))
    .limit(1);

  if (!chapter) throw new SafeServerError(encodeMessage("errors.chapterNotFound"));
  return chapter;
}

/** The viewer's open reports on the comments in this page, for the "Reported" state. */
async function reportedCommentIds(
  viewerId: string | null,
  commentIds: string[],
): Promise<Set<string>> {
  if (!viewerId || commentIds.length === 0) return new Set();
  const rows = await db
    .select({ commentId: reports.commentId })
    .from(reports)
    .where(
      and(
        eq(reports.reporterUserId, viewerId),
        eq(reports.status, "open"),
        inArray(reports.commentId, commentIds),
      ),
    );
  return new Set(rows.flatMap((row) => (row.commentId ? [row.commentId] : [])));
}

/**
 * One page of a chapter's discussion: newest top-level comments first, each with its
 * oldest replies carried inline. An unpublished chapter answers with an empty page rather
 * than an error, so an owner reading their own draft sees no discussion instead of a
 * broken one.
 */
export async function listChapterCommentsForViewer(
  viewerId: string | null,
  input: ListChapterCommentsInput,
): Promise<ChapterCommentPage> {
  const empty: ChapterCommentPage = {
    threads: [],
    rowCount: 0,
    page: input.page,
    pageSize: COMMENT_PAGE_SIZE,
    hasMore: false,
  };

  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(and(eq(chapters.id, input.chapterId), chapterVisibleToGuests(), novelLive()))
    .limit(1);
  if (!chapter) return empty;

  const where = and(
    eq(comments.chapterId, input.chapterId),
    isNull(comments.parentId),
    readableCommentFilter(viewerId),
  );

  const [totals, rows] = await Promise.all([
    db.select({ value: count() }).from(comments).where(where),
    db
      .select(commentColumns)
      .from(comments)
      .leftJoin(user, eq(user.id, comments.userId))
      .where(where)
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(COMMENT_PAGE_SIZE)
      .offset((input.page - 1) * COMMENT_PAGE_SIZE),
  ]);

  const rowCount = totals[0]?.value ?? 0;
  const parentIds = rows.map((row) => row.id);

  const replyWhere = and(inArray(comments.parentId, parentIds), readableCommentFilter(viewerId));
  // Rank replies per thread in SQL so a single long thread cannot crowd out the replies
  // of every other thread on the page.
  const ranked = db
    .select({
      id: comments.id,
      replyRank:
        sql<number>`row_number() over (partition by ${comments.parentId} order by ${comments.createdAt} asc, ${comments.id} asc)`.as(
          "reply_rank",
        ),
    })
    .from(comments)
    .where(parentIds.length ? replyWhere : sql`false`)
    .as("ranked_comments");

  const [replyCounts, replyRows] = await Promise.all([
    parentIds.length
      ? db
          .select({ parentId: comments.parentId, value: count() })
          .from(comments)
          .where(inArray(comments.parentId, parentIds))
          .groupBy(comments.parentId)
      : Promise.resolve([]),
    parentIds.length
      ? db
          .select({ ...commentColumns, replyRank: ranked.replyRank })
          .from(ranked)
          .innerJoin(comments, eq(comments.id, ranked.id))
          .leftJoin(user, eq(user.id, comments.userId))
          .where(lte(ranked.replyRank, COMMENT_REPLY_FETCH_LIMIT))
          .orderBy(asc(comments.createdAt), asc(comments.id))
      : Promise.resolve([]),
  ]);

  const reportedIds = await reportedCommentIds(viewerId, [
    ...parentIds,
    ...replyRows.map((row) => row.id),
  ]);

  const repliesByParent = new Map<string, ChapterComment[]>();
  for (const row of replyRows) {
    const list = repliesByParent.get(row.parentId ?? "") ?? [];
    list.push(toComment(row, viewerId, reportedIds));
    repliesByParent.set(row.parentId ?? "", list);
  }
  const countsByParent = new Map(
    replyCounts.map((row) => [row.parentId ?? "", row.value] as const),
  );

  const threads: CommentThread[] = rows.map((row) => {
    const replies = repliesByParent.get(row.id) ?? [];
    return {
      ...toComment(row, viewerId, reportedIds),
      replies,
      replyCount: countsByParent.get(row.id) ?? replies.length,
      repliesTruncated: (countsByParent.get(row.id) ?? replies.length) > replies.length,
    };
  });

  return {
    threads,
    rowCount,
    page: input.page,
    pageSize: COMMENT_PAGE_SIZE,
    hasMore: input.page * COMMENT_PAGE_SIZE < rowCount,
  };
}

/**
 * Writes one comment or reply. Posting requires a live chapter, so a draft never collects
 * a discussion, and a reply's parent must be a top-level comment in the same chapter:
 * that is the whole one-level rule, enforced where the row is written rather than by the
 * reader trusting the client's `parentId`.
 */
export async function createCommentForUser(
  authorId: string,
  input: CreateCommentInput,
): Promise<{ id: string }> {
  const chapter = await liveChapter(input.chapterId);

  if (input.parentId) {
    const [parent] = await db
      .select({ id: comments.id, parentId: comments.parentId, chapterId: comments.chapterId })
      .from(comments)
      .where(eq(comments.id, input.parentId))
      .limit(1);

    if (!parent || parent.chapterId !== input.chapterId) {
      throw new SafeServerError(encodeMessage("errors.commentGone"));
    }
    if (parent.parentId !== null) {
      throw new SafeServerError(encodeMessage("errors.replyToReply"));
    }
  }

  const id = nanoid();
  await db.insert(comments).values({
    id,
    chapterId: chapter.id,
    novelId: chapter.novelId,
    userId: authorId,
    parentId: input.parentId ?? null,
    body: input.body,
  });
  return { id };
}

/** Edits one's own comment. A removed comment belongs to the record, not its author. */
export async function updateCommentForUser(
  authorId: string,
  input: UpdateCommentInput,
): Promise<{ id: string }> {
  const now = new Date();
  const updated = await db
    .update(comments)
    .set({ body: input.body, editedAt: now, updatedAt: now })
    .where(
      and(
        eq(comments.id, input.commentId),
        eq(comments.userId, authorId),
        isNull(comments.removedAt),
        isNull(comments.deletedAt),
      ),
    )
    .returning({ id: comments.id });

  if (updated.length === 0) throw new SafeServerError(encodeMessage("errors.commentEditNotFound"));
  return { id: input.commentId };
}

/**
 * Deletes one's own comment. A comment with replies is tombstoned instead of removed:
 * hard-deleting it would take other readers' replies with it, so its words go and the
 * thread stays.
 */
export async function deleteCommentForUser(
  authorId: string,
  commentId: string,
): Promise<{ id: string; tombstoned: boolean }> {
  return db.transaction(async (tx) => {
    const [comment] = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.userId, authorId)))
      .for("update")
      .limit(1);

    if (!comment) throw new SafeServerError(encodeMessage("errors.commentMissing"));

    const [replyCount] = await tx
      .select({ value: count() })
      .from(comments)
      .where(eq(comments.parentId, commentId));

    const now = new Date();
    if ((replyCount?.value ?? 0) === 0) {
      await tx.delete(comments).where(eq(comments.id, commentId));
      return { id: commentId, tombstoned: false };
    }

    await tx
      .update(comments)
      .set({ body: null, deletedAt: now, updatedAt: now })
      .where(eq(comments.id, commentId));
    return { id: commentId, tombstoned: true };
  });
}

/**
 * Operator removal, kept separate from the report decision that prompted it. The row
 * stays: the words are gone from every reader, the author sees why, and the case that
 * pointed at it remains legible. Returns false when the comment was already removed, so
 * a second operator is told the content was already down rather than rewriting the note.
 */
export async function removeCommentForOperator(
  actor: { id: string; email: string | null },
  commentId: string,
  reason: string,
): Promise<boolean> {
  const now = new Date();
  const removed = await db
    .update(comments)
    .set({
      removedAt: now,
      removedById: actor.id,
      removedByEmail: actor.email,
      removalReason: reason,
      updatedAt: now,
    })
    .where(and(eq(comments.id, commentId), isNull(comments.removedAt)))
    .returning({ id: comments.id });

  return removed.length > 0;
}

/** The author account of a comment, for the audit trail. */
export async function getCommentAuthor(commentId: string): Promise<{
  userId: string | null;
  email: string | null;
  novelId: string | null;
} | null> {
  const [row] = await db
    .select({ userId: comments.userId, email: user.email, novelId: comments.novelId })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.userId))
    .where(eq(comments.id, commentId))
    .limit(1);
  return row ?? null;
}
