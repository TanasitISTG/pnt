import "@tanstack/react-start/server-only";

import { and, asc, desc, eq, gte, lte, ne, notExists, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chapters, novelFollows, novels, readerChapterReads } from "@/lib/db/schema";
import { encodeMessage } from "@/lib/i18n/message-code";
import { SafeServerError } from "@/lib/server-fn-error";
import { audienceBucketCount, audienceWindowStart, fillDailyBuckets } from "./aggregate";
import type { AudienceRange, ChapterAudience, NovelAudience } from "./types";

/**
 * What the owner's audience looks like, read from the rows the reader already writes.
 *
 * Three rules decide every number here, and they are deliberate rather than incidental:
 *
 * - **The owner is not the audience.** The owner reads their own chapters while working, and
 *   those rows are indistinguishable from a reader's once written, so every query excludes
 *   the novel's `user_id`. Without that, a freshly translated chapter reports "1 reader" before
 *   anyone else has opened it.
 * - **Signed-in readers only.** `reader_chapter_reads` is keyed by account; a guest leaves no
 *   row, so guests are absent from this report entirely rather than counted approximately.
 * - **A read is a finish.** The reader writes the row when the chapter is fully viewed (it
 *   scrolled to the end, or it was short enough to fit), and `read_at` is when that first
 *   happened. Re-reads do not change it, which is why "reads" is "chapters finished", not
 *   "views".
 *
 * The read model takes one novel at a time and is bounded by that novel's chapter count: a
 * handful of indexed aggregate queries, never a per-chapter round trip.
 *
 * The range narrows every figure derived from a read — readers, finishes, the per-chapter
 * counts, the drop-off curve and the daily curve — because they are all answers to the same
 * question about the same rows. Followers and waiting stay current: they are relations, and a
 * follow has no read time for a window to filter on.
 */
export async function getNovelAudienceForUser(
  userId: string,
  novelId: string,
  range: AudienceRange,
  now = new Date(),
): Promise<NovelAudience> {
  const [novel] = await db
    .select({ id: novels.id, ownerId: novels.userId })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);
  if (!novel) throw new SafeServerError(encodeMessage("errors.novelNotFoundOrUnauthorized"));

  const ownerId = novel.ownerId;
  const ownedReads = and(
    eq(readerChapterReads.novelId, novelId),
    ne(readerChapterReads.userId, ownerId),
  );
  const windowStart = audienceWindowStart(range, now);
  // The boundary goes in as text with an explicit cast: a raw `Date` inside a `sql` expression
  // reaches the driver unserialized, and this clause is not a column comparison Drizzle can
  // map for us. All time has no boundary at all, so the filter is the constant `true`.
  const inWindow =
    windowStart === null
      ? sql`true`
      : sql`${readerChapterReads.readAt} >= ${windowStart.toISOString()}::timestamp`;

  const [totalsRow] = await db
    .select({
      readers: sql<number>`count(distinct ${readerChapterReads.userId}) filter (where ${inWindow})::int`,
      reads: sql<number>`count(*) filter (where ${inWindow})::int`,
      // Unfiltered on purpose: the empty state is about the audience never having read, not
      // about the selected range being quiet.
      lifetimeReads: sql<number>`count(*)::int`,
    })
    .from(readerChapterReads)
    .where(ownedReads);

  const [followRow] = await db
    .select({ followers: sql<number>`count(*)::int` })
    .from(novelFollows)
    .where(and(eq(novelFollows.novelId, novelId), ne(novelFollows.userId, ownerId)));

  const [newest] = await db
    .select({
      id: chapters.id,
      number: chapters.number,
      title: chapters.title,
      publishedAt: chapters.publishedAt,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        eq(chapters.status, "translated"),
        lte(chapters.publishedAt, now),
      ),
    )
    .orderBy(desc(chapters.number))
    .limit(1);

  // With no live chapter there is nothing for a follower to have read yet, so every follower
  // is waiting — the number a release would reach.
  let waitingFollowers = followRow?.followers ?? 0;
  if (newest) {
    const [waitingRow] = await db
      .select({ waiting: sql<number>`count(*)::int` })
      .from(novelFollows)
      .where(
        and(
          eq(novelFollows.novelId, novelId),
          ne(novelFollows.userId, ownerId),
          notExists(
            db
              .select({ one: sql`1` })
              .from(readerChapterReads)
              .where(
                and(
                  eq(readerChapterReads.userId, novelFollows.userId),
                  eq(readerChapterReads.chapterId, newest.id),
                ),
              ),
          ),
        ),
      );
    waitingFollowers = waitingRow?.waiting ?? 0;
  }

  const chapterRows = await db
    .select({
      chapterId: chapters.id,
      number: chapters.number,
      title: chapters.title,
      translatedTitle: chapters.translatedTitle,
      publishedAt: chapters.publishedAt,
      readers: sql<number>`count(distinct ${readerChapterReads.userId})::int`,
    })
    .from(chapters)
    .leftJoin(
      readerChapterReads,
      and(
        eq(readerChapterReads.chapterId, chapters.id),
        ne(readerChapterReads.userId, ownerId),
        windowStart === null ? undefined : gte(readerChapterReads.readAt, windowStart),
      ),
    )
    .where(eq(chapters.novelId, novelId))
    .groupBy(chapters.id)
    .orderBy(asc(chapters.number));

  // The drop-off curve: the highest chapter each reader finished, which is where they stopped.
  const reachedRows = await db
    .select({
      userId: readerChapterReads.userId,
      lastNumber: sql<string>`max(${chapters.number})`,
    })
    .from(readerChapterReads)
    .innerJoin(chapters, eq(readerChapterReads.chapterId, chapters.id))
    .where(
      and(
        ownedReads,
        windowStart === null ? undefined : gte(readerChapterReads.readAt, windowStart),
      ),
    )
    .groupBy(readerChapterReads.userId);

  const lastReachedByNumber = new Map<number, number>();
  for (const row of reachedRows) {
    const key = Number(row.lastNumber);
    lastReachedByNumber.set(key, (lastReachedByNumber.get(key) ?? 0) + 1);
  }

  // `read_at` is a naive timestamp written by this server's clock (UTC in deployment), so the
  // bucket is its own date rather than a conversion that would shift it through whatever
  // timezone the database session happens to carry.
  const dayExpression = sql<string>`to_char(${readerChapterReads.readAt}, 'YYYY-MM-DD')`;
  const dailyRawRows = await db
    .select({
      day: dayExpression,
      reads: sql<number>`count(*)::int`,
    })
    .from(readerChapterReads)
    .where(
      and(
        ownedReads,
        windowStart === null ? undefined : gte(readerChapterReads.readAt, windowStart),
      ),
    )
    // Grouped by the expression, not by the ordinal: a positional group in a `sql` fragment
    // is a constant to the planner's eye more easily than it is the first column.
    .groupBy(dayExpression);

  const dailyRows = dailyRawRows.map((row) => ({ day: row.day, reads: Number(row.reads) }));

  const chapterAudience: ChapterAudience[] = chapterRows.map((row) => {
    const number = Number(row.number);
    return {
      chapterId: row.chapterId,
      number,
      title: row.title,
      translatedTitle: row.translatedTitle,
      publishedAt: row.publishedAt,
      readers: Number(row.readers),
      lastReached: lastReachedByNumber.get(number) ?? 0,
    };
  });

  return {
    totals: {
      readers: Number(totalsRow?.readers ?? 0),
      reads: Number(totalsRow?.reads ?? 0),
      followers: Number(followRow?.followers ?? 0),
      waitingFollowers: Number(waitingFollowers),
      hasAnyReads: Number(totalsRow?.lifetimeReads ?? 0) > 0,
      newestChapter: newest
        ? {
            id: newest.id,
            number: Number(newest.number),
            title: newest.title,
            publishedAt: newest.publishedAt,
          }
        : null,
    },
    chapters: chapterAudience,
    daily: fillDailyBuckets(dailyRows, now, audienceBucketCount(range, dailyRows, now)),
  };
}
