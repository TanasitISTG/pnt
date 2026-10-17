import "@tanstack/react-start/server-only";

import { and, avg, count, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { novels, reports, reviews, user } from "@/lib/db/schema";
import { isUniqueViolation } from "@/lib/db/unique-violation";
import { novelLive, novelReadable } from "@/lib/content/publish/publish";
import { notifyNovelReview, runNotificationWrite } from "@/lib/notifications/service.server";
import { resolveUserAvatar } from "@/lib/profile/avatar.server";
import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";
import { nanoid } from "@/lib/utils";

import {
  REVIEW_BODY_MAX_LENGTH,
  REVIEW_PAGE_SIZE,
  type ListNovelReviewsInput,
  type SaveReviewInput,
} from "./schemas";
import type { NovelRatingSummary, NovelReview, NovelReviewPage } from "./types";

/**
 * Novel reviews: one live review per account per novel, a summary everyone can see, and
 * an operator removal that is separate from the report decision that prompted it.
 *
 * Visibility follows the same rule as comments: a removed review is gone for everyone
 * except its author, who still sees it as removed with the reason. The summary and every
 * list count only live reviews, so a removal moves the average immediately.
 */

const reviewColumns = {
  id: reviews.id,
  rating: reviews.rating,
  body: reviews.body,
  createdAt: reviews.createdAt,
  editedAt: reviews.editedAt,
  removedAt: reviews.removedAt,
  removalReason: reviews.removalReason,
  authorId: user.id,
  authorName: user.name,
  authorImage: user.image,
};

type ReviewRow = {
  id: string;
  rating: number;
  body: string | null;
  createdAt: Date;
  editedAt: Date | null;
  removedAt: Date | null;
  removalReason: string | null;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
};

function toReview(
  row: ReviewRow,
  viewerId: string | null,
  reportedIds: ReadonlySet<string>,
): NovelReview {
  return {
    id: row.id,
    rating: row.rating,
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    removedAt: row.removedAt,
    removalReason: row.removalReason,
    author: {
      id: row.authorId,
      name: row.authorName,
      avatar: row.authorId ? resolveUserAvatar(row.authorImage) : null,
    },
    isOwn: viewerId !== null && row.authorId === viewerId,
    viewerReported: reportedIds.has(row.id),
  };
}

/** The viewer's open reports on the reviews in this page, for the "Reported" state. */
async function reportedReviewIds(
  viewerId: string | null,
  reviewIds: string[],
): Promise<Set<string>> {
  if (!viewerId || reviewIds.length === 0) return new Set();
  const rows = await db
    .select({ reviewId: reports.reviewId })
    .from(reports)
    .where(
      and(
        eq(reports.reporterUserId, viewerId),
        eq(reports.status, "open"),
        inArray(reports.reviewId, reviewIds),
      ),
    );
  return new Set(rows.flatMap((row) => (row.reviewId ? [row.reviewId] : [])));
}

/** Read visibility of a novel for a viewer, or null when it is not readable. */
async function readableNovel(
  viewerId: string | null,
  novelId: string,
): Promise<{ id: string; userId: string } | null> {
  const [novel] = await db
    .select({ id: novels.id, userId: novels.userId })
    .from(novels)
    .where(and(eq(novels.id, novelId), novelReadable(viewerId)))
    .limit(1);
  return novel ?? null;
}

/**
 * The score beside the title: average to one decimal, count, and the 5-to-1 distribution
 * the bars are drawn from. A novel nobody has rated answers with a null average so the
 * page can say nothing at all rather than "0.0".
 */
export async function getNovelRatingForViewer(
  viewerId: string | null,
  novelId: string,
): Promise<NovelRatingSummary> {
  const empty: NovelRatingSummary = {
    average: null,
    count: 0,
    distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })),
  };

  const novel = await readableNovel(viewerId, novelId);
  if (!novel) return empty;

  const [totals, buckets] = await Promise.all([
    db
      .select({
        average: avg(reviews.rating),
        count: count(),
      })
      .from(reviews)
      .where(and(eq(reviews.novelId, novelId), isNull(reviews.removedAt))),
    db
      .select({ rating: reviews.rating, count: count() })
      .from(reviews)
      .where(and(eq(reviews.novelId, novelId), isNull(reviews.removedAt)))
      .groupBy(reviews.rating),
  ]);

  const bucketByRating = new Map(buckets.map((bucket) => [bucket.rating, bucket.count] as const));
  const total = totals[0]?.count ?? 0;
  const average = totals[0]?.average == null ? null : Number(totals[0].average);

  return {
    average: average === null ? null : Math.round(average * 10) / 10,
    count: total,
    distribution: [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: bucketByRating.get(rating) ?? 0,
    })),
  };
}

/** One page of a novel's reviews, newest first, minus other people's removed ones. */
export async function listNovelReviewsForViewer(
  viewerId: string | null,
  input: ListNovelReviewsInput,
): Promise<NovelReviewPage> {
  const empty: NovelReviewPage = {
    reviews: [],
    rowCount: 0,
    page: input.page,
    pageSize: REVIEW_PAGE_SIZE,
    hasMore: false,
  };

  const novel = await readableNovel(viewerId, input.novelId);
  if (!novel) return empty;

  const visible = and(
    eq(reviews.novelId, input.novelId),
    viewerId
      ? or(isNull(reviews.removedAt), eq(reviews.userId, viewerId))
      : isNull(reviews.removedAt),
  );

  const [totals, rows] = await Promise.all([
    db.select({ value: count() }).from(reviews).where(visible),
    db
      .select(reviewColumns)
      .from(reviews)
      .leftJoin(user, eq(user.id, reviews.userId))
      .where(visible)
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(REVIEW_PAGE_SIZE)
      .offset((input.page - 1) * REVIEW_PAGE_SIZE),
  ]);

  const reportedIds = await reportedReviewIds(
    viewerId,
    rows.map((row) => row.id),
  );
  const rowCount = totals[0]?.value ?? 0;

  return {
    reviews: rows.map((row) => toReview(row, viewerId, reportedIds)),
    rowCount,
    page: input.page,
    pageSize: REVIEW_PAGE_SIZE,
    hasMore: input.page * REVIEW_PAGE_SIZE < rowCount,
  };
}

/**
 * The viewer's own review in one novel, live or removed. It exists so the review section
 * can pin "Your review" at the top - and let its author fix a typo or a rating - without
 * hunting through pages, and so a removed review is never invisible to the person who
 * wrote it.
 */
export async function getMyReviewForUser(
  viewerId: string,
  novelId: string,
): Promise<NovelReview | null> {
  const [row] = await db
    .select(reviewColumns)
    .from(reviews)
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(and(eq(reviews.novelId, novelId), eq(reviews.userId, viewerId)))
    .limit(1);

  if (!row) return null;
  return toReview(row, viewerId, new Set());
}

/**
 * Creates or edits one's own review. The novel has to be live - a draft cannot be
 * reviewed, because it cannot be read - and it must not be one's own: authors write
 * novels, readers rate them. The unique index, not a read-then-write, is the final guard
 * against two reviews landing at once, and a lost race is resolved by editing the row
 * that won.
 */
export async function saveReviewForUser(
  userId: string,
  input: SaveReviewInput,
): Promise<{ id: string }> {
  const [novel] = await db
    .select({ id: novels.id, userId: novels.userId })
    .from(novels)
    .where(and(eq(novels.id, input.novelId), novelLive()))
    .limit(1);

  if (!novel) throw new SafeServerError(encodeMessage("errors.novelNotFound"));
  if (novel.userId === userId) {
    throw new SafeServerError(encodeMessage("errors.ownNovelReview"));
  }

  const trimmedBody = (input.body ?? "").slice(0, REVIEW_BODY_MAX_LENGTH);
  const body = trimmedBody.length > 0 ? trimmedBody : null;
  const now = new Date();

  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.novelId, input.novelId),
        eq(reviews.userId, userId),
        isNull(reviews.removedAt),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(reviews)
      .set({ rating: input.rating, body, editedAt: now, updatedAt: now })
      .where(eq(reviews.id, existing.id));
    return { id: existing.id };
  }

  const id = nanoid();
  let created = false;
  try {
    await db.insert(reviews).values({
      id,
      novelId: input.novelId,
      userId,
      rating: input.rating,
      body,
    });
    created = true;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Another request inserted the same account's review in the gap above; editing it is
    // exactly what this call meant to do.
    await db
      .update(reviews)
      .set({ rating: input.rating, body, editedAt: now, updatedAt: now })
      .where(
        and(
          eq(reviews.novelId, input.novelId),
          eq(reviews.userId, userId),
          isNull(reviews.removedAt),
        ),
      );
  }

  // The owner hears about a new review once. An edit returns above and never reaches this,
  // and the dedupe key would absorb a repeated report anyway; the review is already written,
  // so the owner's badge is a courtesy that must not fail the save.
  if (created) {
    await runNotificationWrite("novel review", () => notifyNovelReview(id));
  }

  return { id };
}

/** Deletes one's own review, taking its rating out of the average. */
export async function deleteReviewForUser(userId: string, novelId: string): Promise<boolean> {
  const deleted = await db
    .delete(reviews)
    .where(and(eq(reviews.novelId, novelId), eq(reviews.userId, userId)))
    .returning({ id: reviews.id });
  return deleted.length > 0;
}

/**
 * Operator removal: the rating leaves the summary, the words leave every reader, and the
 * author keeps a note of why. The row stays for the record, and because the unique index
 * is partial it no longer blocks the author from writing a fresh review later.
 */
export async function removeReviewForOperator(
  actor: { id: string; email: string | null },
  reviewId: string,
  reason: string,
): Promise<boolean> {
  const now = new Date();
  const removed = await db
    .update(reviews)
    .set({
      removedAt: now,
      removedById: actor.id,
      removedByEmail: actor.email,
      removalReason: reason,
      updatedAt: now,
    })
    .where(and(eq(reviews.id, reviewId), isNull(reviews.removedAt)))
    .returning({ id: reviews.id });

  return removed.length > 0;
}

/** The author account of a review, for the audit trail. */
export async function getReviewAuthor(reviewId: string): Promise<{
  userId: string | null;
  email: string | null;
  novelId: string | null;
} | null> {
  const [row] = await db
    .select({ userId: reviews.userId, email: user.email, novelId: reviews.novelId })
    .from(reviews)
    .leftJoin(user, eq(user.id, reviews.userId))
    .where(eq(reviews.id, reviewId))
    .limit(1);
  return row ?? null;
}
