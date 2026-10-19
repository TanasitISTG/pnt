import "@tanstack/react-start/server-only";

import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { novelFollows, novels, readerChapterReads } from "@/lib/db/schema";
import { audienceBucketCount, audienceWindowStart, fillDailyBuckets } from "./aggregate";
import type { AccountAudience, AudienceRange, NovelAudienceRow } from "./types";

/**
 * The account's audience, rolled up from the same rows the per-novel report reads.
 *
 * The counting rules are the per-novel ones, and the interesting part is where a rollup
 * differs from a sum:
 *
 * - **Readers are distinct across the account.** Somebody who finished three of the owner's
 *   novels is one reader here, so the total is its own query rather than the column's sum.
 * - **Reads, followers and waiting do add up.** A read belongs to exactly one novel, and a
 *   follow is a relation with one novel, so those totals are sums of the per-novel counts.
 * - **The owner is still not the audience**, on every novel: `reader_chapter_reads` does not
 *   distinguish the author's own reading from anyone else's, so every query excludes the
 *   account that owns the novel.
 * - **Only signed-in readers exist.** A guest leaves no row at all, so the report is silent
 *   about them rather than approximate.
 *
 * The read is bounded by the account's novels, not by their chapters: one grouped aggregate
 * per question, and the only per-novel work is the lateral part of the waiting-follower
 * query, which the chapters and reads indexes answer.
 *
 * The range narrows reads and readers on the totals, each novel's row and the daily curve. The
 * novel, published-novel, follower and waiting counts stay current, because they describe a
 * state rather than a period.
 */
export async function getAccountAudienceForUser(
  userId: string,
  range: AudienceRange,
  now = new Date(),
): Promise<AccountAudience> {
  const owned = await db
    .select({ id: novels.id, title: novels.title, publishedAt: novels.publishedAt })
    .from(novels)
    .where(eq(novels.userId, userId))
    .orderBy(asc(novels.title), asc(novels.id));

  const windowStart = audienceWindowStart(range, now);
  if (owned.length === 0) {
    return {
      totals: {
        novels: 0,
        publishedNovels: 0,
        readers: 0,
        reads: 0,
        followers: 0,
        waitingFollowers: 0,
        hasAnyReads: false,
      },
      novels: [],
      daily: fillDailyBuckets([], now, audienceBucketCount(range, [], now)),
    };
  }

  const novelIds = owned.map((novel) => novel.id);
  const ownedReads = inArray(readerChapterReads.novelId, novelIds);
  const audienceReads = and(ownedReads, ne(readerChapterReads.userId, userId));
  // The boundary goes in as text with an explicit cast: a raw `Date` inside a `sql`
  // expression reaches the driver unserialized, which is what this clause needs to avoid.
  const inWindow =
    windowStart === null
      ? sql`true`
      : sql`${readerChapterReads.readAt} >= ${windowStart.toISOString()}::timestamp`;

  const [totalsRow] = await db
    .select({
      readers: sql<number>`count(distinct ${readerChapterReads.userId}) filter (where ${inWindow})::int`,
      reads: sql<number>`count(*) filter (where ${inWindow})::int`,
      // Unfiltered: the report's empty state asks whether anyone ever read, not whether the
      // selected range happened to be quiet.
      lifetimeReads: sql<number>`count(*)::int`,
    })
    .from(readerChapterReads)
    .where(audienceReads);

  const readRows = await db
    .select({
      novelId: readerChapterReads.novelId,
      readers: sql<number>`count(distinct ${readerChapterReads.userId}) filter (where ${inWindow})::int`,
      reads: sql<number>`count(*) filter (where ${inWindow})::int`,
    })
    .from(readerChapterReads)
    .where(audienceReads)
    .groupBy(readerChapterReads.novelId);

  const followRows = await db
    .select({
      novelId: novelFollows.novelId,
      followers: sql<number>`count(*)::int`,
    })
    .from(novelFollows)
    .where(and(inArray(novelFollows.novelId, novelIds), ne(novelFollows.userId, userId)))
    .groupBy(novelFollows.novelId);

  // "Waiting" is per novel, because it is a relation to that novel's newest live chapter: a
  // follower who finished the latest chapter of one novel is still waiting for another. With
  // no live chapter there is nothing to have finished, so every follower of it waits.
  const waitingRows = await db.execute<{ novelId: string; waiting: number }>(sql`
    SELECT f."novel_id" AS "novelId", count(*)::int AS "waiting"
    FROM "novel_follows" AS f
    INNER JOIN "novels" AS n ON n."id" = f."novel_id"
    WHERE n."user_id" = ${userId}
      AND f."user_id" <> ${userId}
      AND NOT EXISTS (
        SELECT 1
        FROM "chapters" AS c
        INNER JOIN "reader_chapter_reads" AS r
          ON r."chapter_id" = c."id" AND r."user_id" = f."user_id"
        WHERE c."novel_id" = n."id"
          AND c."status" = 'translated'
          AND c."published_at" IS NOT NULL
          AND c."published_at" <= ${now.toISOString()}::timestamp
          AND c."number" = (
            SELECT max(c2."number")
            FROM "chapters" AS c2
            WHERE c2."novel_id" = n."id"
              AND c2."status" = 'translated'
              AND c2."published_at" IS NOT NULL
              AND c2."published_at" <= ${now.toISOString()}::timestamp
          )
      )
    GROUP BY f."novel_id"
  `);

  const dayExpression = sql<string>`to_char(${readerChapterReads.readAt}, 'YYYY-MM-DD')`;
  const dailyRawRows = await db
    .select({ day: dayExpression, reads: sql<number>`count(*)::int` })
    .from(readerChapterReads)
    .where(
      and(
        audienceReads,
        windowStart === null ? undefined : gte(readerChapterReads.readAt, windowStart),
      ),
    )
    .groupBy(dayExpression);
  const dailyRows = dailyRawRows.map((row) => ({ day: row.day, reads: Number(row.reads) }));

  const readsByNovel = new Map(readRows.map((row) => [row.novelId, row]));
  const followersByNovel = new Map(followRows.map((row) => [row.novelId, Number(row.followers)]));
  const waitingByNovel = new Map(waitingRows.map((row) => [row.novelId, Number(row.waiting)]));

  const novelRows: NovelAudienceRow[] = owned
    .map((novel) => {
      const reads = readsByNovel.get(novel.id);
      return {
        id: novel.id,
        title: novel.title,
        publishedAt: novel.publishedAt,
        readers: Number(reads?.readers ?? 0),
        reads: Number(reads?.reads ?? 0),
        followers: followersByNovel.get(novel.id) ?? 0,
        waitingFollowers: waitingByNovel.get(novel.id) ?? 0,
      };
    })
    // Most-read first, then alphabetical: the row a writer is looking for is the one with the
    // audience, and the tie-break is total so the order does not move between identical reads.
    .toSorted(
      (left, right) =>
        right.readers - left.readers ||
        right.reads - left.reads ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    );

  return {
    totals: {
      novels: owned.length,
      publishedNovels: owned.filter(
        (novel) => novel.publishedAt !== null && novel.publishedAt.getTime() <= now.getTime(),
      ).length,
      readers: Number(totalsRow?.readers ?? 0),
      reads: Number(totalsRow?.reads ?? 0),
      followers: followRows.reduce((sum, row) => sum + Number(row.followers), 0),
      waitingFollowers: waitingRows.reduce((sum, row) => sum + Number(row.waiting), 0),
      hasAnyReads: Number(totalsRow?.lifetimeReads ?? 0) > 0,
    },
    novels: novelRows,
    daily: fillDailyBuckets(dailyRows, now, audienceBucketCount(range, dailyRows, now)),
  };
}
