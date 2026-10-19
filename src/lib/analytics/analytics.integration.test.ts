import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Sql } from "postgres";

import {
  closeIntegrationDatabase,
  describeIntegration,
  openIntegrationDatabase,
} from "@/test/integration";

/**
 * The audience report's counting rules, held against a real database.
 *
 * These are the properties that a "sum the numbers in the UI" implementation gets wrong: the
 * owner's own reads are not an audience, a follower who finished the newest chapter is not
 * waiting, a reader counts once per chapter no matter how often they return, and a range is a
 * window rather than a lifetime total — while a quiet window is still a report, not an empty
 * audience. The aggregation helpers are tested beside the module; what is here is what only
 * the queries can answer.
 */

let sql: Sql;
let getNovelAudienceForUser: typeof import("./novel-analytics.server").getNovelAudienceForUser;
let getAccountAudienceForUser: typeof import("./account-audience.server").getAccountAudienceForUser;

const NOW = new Date("2026-10-17T12:00:00.000Z");
const RECENT = new Date("2026-10-10T12:00:00.000Z");
const OLD = new Date("2026-07-01T12:00:00.000Z");
const PAST = new Date("2026-09-01T00:00:00.000Z");

interface Fixture {
  ownerId: string;
  otherOwnerId: string;
  readerA: string;
  readerB: string;
  readerC: string;
  followerOnly: string;
  followerCaughtUp: string;
  novelId: string;
  chapterIds: string[];
}

async function seed(): Promise<Fixture> {
  const ids = {
    ownerId: `user-${randomUUID()}`,
    otherOwnerId: `user-${randomUUID()}`,
    readerA: `user-${randomUUID()}`,
    readerB: `user-${randomUUID()}`,
    readerC: `user-${randomUUID()}`,
    followerOnly: `user-${randomUUID()}`,
    followerCaughtUp: `user-${randomUUID()}`,
    novelId: `novel-${randomUUID()}`,
    chapterIds: [1, 2, 3].map(() => `chapter-${randomUUID()}`),
  };

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ids.ownerId}, 'Analytics Owner', ${`${ids.ownerId}@example.test`}, true, now(), now()),
      (${ids.otherOwnerId}, 'Other Owner', ${`${ids.otherOwnerId}@example.test`}, true, now(), now()),
      (${ids.readerA}, 'Reader A', ${`${ids.readerA}@example.test`}, true, now(), now()),
      (${ids.readerB}, 'Reader B', ${`${ids.readerB}@example.test`}, true, now(), now()),
      (${ids.readerC}, 'Reader C', ${`${ids.readerC}@example.test`}, true, now(), now()),
      (${ids.followerOnly}, 'Follower Only', ${`${ids.followerOnly}@example.test`}, true, now(), now()),
      (${ids.followerCaughtUp}, 'Caught Up', ${`${ids.followerCaughtUp}@example.test`}, true, now(), now())
  `;

  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at"
    ) VALUES (${ids.novelId}, ${ids.ownerId}, 'Audience Fixture', 'en', 'th', ${PAST}, now(), now())
  `;

  for (const [index, chapterId] of ids.chapterIds.entries()) {
    await sql`
      INSERT INTO "chapters" (
        "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
        "raw_char_count", "published_at", "created_at", "updated_at"
      ) VALUES (
        ${chapterId}, ${ids.novelId}, ${index + 1}, ${`Chapter ${index + 1}`}, 'Raw.',
        'Translated.', 'translated', 4, ${PAST}, now(), now()
      )
    `;
  }

  // A second novel, published, with a read of its own: the report must not see it.
  const otherNovelId = `novel-${randomUUID()}`;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at"
    ) VALUES (${otherNovelId}, ${ids.otherOwnerId}, 'Someone Else', 'en', 'th', ${PAST}, now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
      "raw_char_count", "published_at", "created_at", "updated_at"
    ) VALUES (${`chapter-${randomUUID()}`}, ${otherNovelId}, 1, 'Elsewhere', 'Raw.',
      'Translated.', 'translated', 4, ${PAST}, now(), now())
  `;

  const [otherChapter] = await sql<{ id: string }[]>`
    SELECT "id" FROM "chapters" WHERE "novel_id" = ${otherNovelId} LIMIT 1
  `;

  const reads: Array<[string, string, string, Date]> = [
    // The owner reading their own work: present in the table, absent from the report.
    [ids.ownerId, ids.novelId, ids.chapterIds[0], RECENT],
    [ids.readerA, ids.novelId, ids.chapterIds[0], RECENT],
    [ids.readerA, ids.novelId, ids.chapterIds[1], RECENT],
    [ids.readerB, ids.novelId, ids.chapterIds[0], RECENT],
    // Older than the thirty-day window: counted in the lifetime totals, not the window.
    [ids.readerC, ids.novelId, ids.chapterIds[0], OLD],
    [ids.followerCaughtUp, ids.novelId, ids.chapterIds[2], RECENT],
    // Another novel entirely.
    [ids.readerB, otherNovelId, otherChapter.id, RECENT],
  ];
  for (const [userId, novelId, chapterId, readAt] of reads) {
    await sql`
      INSERT INTO "reader_chapter_reads" ("user_id", "novel_id", "chapter_id", "read_at")
      VALUES (${userId}, ${novelId}, ${chapterId}, ${readAt})
    `;
  }

  await sql`
    INSERT INTO "novel_follows" ("user_id", "novel_id", "created_at")
    VALUES
      (${ids.followerOnly}, ${ids.novelId}, now()),
      (${ids.followerCaughtUp}, ${ids.novelId}, now())
  `;

  return { ...ids, otherOwnerId: ids.otherOwnerId };
}

async function cleanup(fixture: Fixture) {
  await sql`DELETE FROM "user" WHERE "id" IN (
    ${fixture.ownerId}, ${fixture.otherOwnerId}, ${fixture.readerA}, ${fixture.readerB},
    ${fixture.readerC}, ${fixture.followerOnly}, ${fixture.followerCaughtUp}
  )`;
}

interface AccountFixture {
  ownerId: string;
  otherOwnerId: string;
  readerA: string;
  readerB: string;
  followerOnly: string;
  followerCaughtUp: string;
  /** Three owned novels: two live and read, one still a draft nobody has touched. */
  novelIds: { readMost: string; readOnce: string; draft: string; other: string };
  chapterIds: {
    mostFirst: string;
    mostNewest: string;
    onceFirst: string;
    draftFirst: string;
    otherFirst: string;
  };
}

async function seedAccount(): Promise<AccountFixture> {
  const ids: AccountFixture = {
    ownerId: `user-${randomUUID()}`,
    otherOwnerId: `user-${randomUUID()}`,
    readerA: `user-${randomUUID()}`,
    readerB: `user-${randomUUID()}`,
    followerOnly: `user-${randomUUID()}`,
    followerCaughtUp: `user-${randomUUID()}`,
    novelIds: {
      readMost: `novel-${randomUUID()}`,
      readOnce: `novel-${randomUUID()}`,
      draft: `novel-${randomUUID()}`,
      other: `novel-${randomUUID()}`,
    },
    chapterIds: {
      mostFirst: `chapter-${randomUUID()}`,
      mostNewest: `chapter-${randomUUID()}`,
      onceFirst: `chapter-${randomUUID()}`,
      draftFirst: `chapter-${randomUUID()}`,
      otherFirst: `chapter-${randomUUID()}`,
    },
  };

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${ids.ownerId}, 'Account Owner', ${`${ids.ownerId}@example.test`}, true, now(), now()),
      (${ids.otherOwnerId}, 'Other Owner', ${`${ids.otherOwnerId}@example.test`}, true, now(), now()),
      (${ids.readerA}, 'Reader A', ${`${ids.readerA}@example.test`}, true, now(), now()),
      (${ids.readerB}, 'Reader B', ${`${ids.readerB}@example.test`}, true, now(), now()),
      (${ids.followerOnly}, 'Follower Only', ${`${ids.followerOnly}@example.test`}, true, now(), now()),
      (${ids.followerCaughtUp}, 'Caught Up', ${`${ids.followerCaughtUp}@example.test`}, true, now(), now())
  `;

  const insertNovel = (id: string, ownerId: string, title: string, publishedAt: Date | null) => sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "published_at", "created_at", "updated_at"
    ) VALUES (${id}, ${ownerId}, ${title}, 'en', 'th', ${publishedAt}, now(), now())
  `;
  await insertNovel(ids.novelIds.readMost, ids.ownerId, "Read Most", PAST);
  await insertNovel(ids.novelIds.readOnce, ids.ownerId, "Read Once", PAST);
  await insertNovel(ids.novelIds.draft, ids.ownerId, "Still A Draft", null);
  await insertNovel(ids.novelIds.other, ids.otherOwnerId, "Someone Else", PAST);

  const insertChapter = (
    id: string,
    novelId: string,
    number: number,
    title: string,
    publishedAt: Date | null,
    status: "translated" | "raw",
  ) => sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "raw_content", "translated_content", "status",
      "raw_char_count", "published_at", "created_at", "updated_at"
    ) VALUES (
      ${id}, ${novelId}, ${number}, ${title}, 'Raw.',
      ${status === "translated" ? "Translated." : null}, ${status}, 4, ${publishedAt}, now(), now()
    )
  `;
  await insertChapter(
    ids.chapterIds.mostFirst,
    ids.novelIds.readMost,
    1,
    "Most 1",
    PAST,
    "translated",
  );
  await insertChapter(
    ids.chapterIds.mostNewest,
    ids.novelIds.readMost,
    2,
    "Most 2",
    PAST,
    "translated",
  );
  await insertChapter(
    ids.chapterIds.onceFirst,
    ids.novelIds.readOnce,
    1,
    "Once 1",
    PAST,
    "translated",
  );
  await insertChapter(ids.chapterIds.draftFirst, ids.novelIds.draft, 1, "Draft 1", null, "raw");
  await insertChapter(
    ids.chapterIds.otherFirst,
    ids.novelIds.other,
    1,
    "Else 1",
    PAST,
    "translated",
  );

  const reads: Array<[string, string, string, Date]> = [
    // The owner reading their own work: present in the table, absent from every count.
    [ids.ownerId, ids.novelIds.readMost, ids.chapterIds.mostFirst, RECENT],
    // One reader across two novels: one reader for the account, one per novel.
    [ids.readerA, ids.novelIds.readMost, ids.chapterIds.mostFirst, RECENT],
    [ids.readerA, ids.novelIds.readMost, ids.chapterIds.mostNewest, RECENT],
    [ids.readerA, ids.novelIds.readOnce, ids.chapterIds.onceFirst, RECENT],
    [ids.readerB, ids.novelIds.readMost, ids.chapterIds.mostNewest, RECENT],
    // A follower who has finished the newest chapter is caught up, not waiting.
    [ids.followerCaughtUp, ids.novelIds.readMost, ids.chapterIds.mostNewest, RECENT],
    // Another owner's novel and its read: invisible to this account's report.
    [ids.readerB, ids.novelIds.other, ids.chapterIds.otherFirst, RECENT],
  ];
  for (const [userId, novelId, chapterId, readAt] of reads) {
    await sql`
      INSERT INTO "reader_chapter_reads" ("user_id", "novel_id", "chapter_id", "read_at")
      VALUES (${userId}, ${novelId}, ${chapterId}, ${readAt})
    `;
  }

  // The follower with nothing read is waiting on both live novels; the caught-up one waits
  // on neither. The draft has no follower at all.
  await sql`
    INSERT INTO "novel_follows" ("user_id", "novel_id", "created_at")
    VALUES
      (${ids.followerCaughtUp}, ${ids.novelIds.readMost}, now()),
      (${ids.followerOnly}, ${ids.novelIds.readMost}, now()),
      (${ids.followerOnly}, ${ids.novelIds.readOnce}, now())
  `;

  return ids;
}

async function cleanupAccount(fixture: AccountFixture) {
  await sql`DELETE FROM "user" WHERE "id" IN (
    ${fixture.ownerId}, ${fixture.otherOwnerId}, ${fixture.readerA}, ${fixture.readerB},
    ${fixture.followerOnly}, ${fixture.followerCaughtUp}
  )`;
}

describeIntegration("novel audience PostgreSQL contracts", () => {
  beforeAll(async () => {
    ({ sql } = openIntegrationDatabase(import.meta.url));
    ({ getNovelAudienceForUser } = await import("./novel-analytics.server"));
    ({ getAccountAudienceForUser } = await import("./account-audience.server"));
  });

  afterAll(closeIntegrationDatabase);

  it("counts readers, drop-off, waiting followers and the window from the rows readers write", async () => {
    const fixture = await seed();
    try {
      const audience = await getNovelAudienceForUser(fixture.ownerId, fixture.novelId, "30d", NOW);

      // The owner's own read and the other novel's read are both invisible here, and reader C's
      // read predates the window, so only three readers are inside it.
      expect(audience.totals).toMatchObject({
        readers: 3,
        reads: 4,
        followers: 2,
        waitingFollowers: 1,
        hasAnyReads: true,
      });
      expect(audience.totals.newestChapter).toMatchObject({ number: 3, title: "Chapter 3" });

      const byNumber = new Map(audience.chapters.map((chapter) => [chapter.number, chapter]));
      // A and B finished chapter one inside the window; C's older read is not here.
      expect(byNumber.get(1)).toMatchObject({ readers: 2, lastReached: 1 });
      expect(byNumber.get(2)).toMatchObject({ readers: 1, lastReached: 1 });
      // The caught-up follower stopped at the newest chapter, which is why they are not waiting.
      expect(byNumber.get(3)).toMatchObject({ readers: 1, lastReached: 1 });

      expect(audience.chapters.map((chapter) => chapter.number)).toEqual([1, 2, 3]);

      // Thirty buckets, ending today, and only the four reads inside the window.
      expect(audience.daily).toHaveLength(30);
      expect(audience.daily.at(-1)?.day).toBe(NOW.toISOString().slice(0, 10));
      expect(audience.daily.find((bucket) => bucket.day === "2026-10-10")?.reads).toBe(4);
      expect(audience.daily.reduce((sum, bucket) => sum + bucket.reads, 0)).toBe(4);
    } finally {
      await cleanup(fixture);
    }
  });

  it("reads a short range as a window, and an empty window as quiet rather than empty", async () => {
    const fixture = await seed();
    try {
      // Seven days ending on the 13th covers the four recent finishes.
      const recent = await getNovelAudienceForUser(
        fixture.ownerId,
        fixture.novelId,
        "7d",
        new Date("2026-10-13T12:00:00.000Z"),
      );
      expect(recent.totals).toMatchObject({ readers: 3, reads: 4, hasAnyReads: true });
      expect(recent.daily).toHaveLength(7);
      expect(recent.daily.at(-1)?.day).toBe("2026-10-13");
      expect(recent.daily.reduce((sum, bucket) => sum + bucket.reads, 0)).toBe(4);

      // The same week of the next week: nobody finished a chapter. That is not an empty
      // audience, so the lifetime flag stays true and the fan-out figures stay at zero.
      const quiet = await getNovelAudienceForUser(fixture.ownerId, fixture.novelId, "7d", NOW);
      expect(quiet.totals).toMatchObject({
        readers: 0,
        reads: 0,
        // Followers and waiting are current relations, not reads, so the window leaves them.
        followers: 2,
        waitingFollowers: 1,
        hasAnyReads: true,
      });
      expect(quiet.chapters.every((chapter) => chapter.readers === 0)).toBe(true);
      expect(quiet.daily).toHaveLength(7);
      expect(quiet.daily.reduce((sum, bucket) => sum + bucket.reads, 0)).toBe(0);

      // All time is the lifetime, and its curve starts at the first read rather than at a
      // fixed number of days: 2026-07-01 through 2026-10-17 inclusive.
      const lifetime = await getNovelAudienceForUser(fixture.ownerId, fixture.novelId, "all", NOW);
      expect(lifetime.totals).toMatchObject({ readers: 4, reads: 5, hasAnyReads: true });
      expect(lifetime.chapters[0]).toMatchObject({ readers: 3, lastReached: 2 });
      expect(lifetime.daily).toHaveLength(109);
      expect(lifetime.daily[0]).toEqual({ day: "2026-07-01", reads: 1 });
      expect(lifetime.daily.at(-1)?.day).toBe(NOW.toISOString().slice(0, 10));
      expect(lifetime.daily.reduce((sum, bucket) => sum + bucket.reads, 0)).toBe(5);
    } finally {
      await cleanup(fixture);
    }
  });

  it("rolls every owned novel up without summing away distinct readers or inventing waiting ones", async () => {
    const fixture = await seedAccount();
    try {
      const audience = await getAccountAudienceForUser(fixture.ownerId, "30d", NOW);

      expect(audience.totals).toMatchObject({
        novels: 3,
        // The draft is owned but not published.
        publishedNovels: 2,
        // Three people read; the owner's own read is not one of them.
        readers: 3,
        reads: 5,
        followers: 3,
        // One follower is waiting on each live novel; the caught-up one is waiting on neither.
        waitingFollowers: 2,
        hasAnyReads: true,
      });

      // The per-novel readers add to four because reader A read two novels; the account's
      // distinct count is the point of the rollup.
      expect(audience.novels.reduce((sum, row) => sum + row.readers, 0)).toBe(4);
      expect(audience.novels.map((row) => row.title)).toEqual([
        "Read Most",
        "Read Once",
        "Still A Draft",
      ]);
      expect(audience.novels[0]).toMatchObject({
        readers: 3,
        reads: 4,
        followers: 2,
        waitingFollowers: 1,
      });
      expect(audience.novels[1]).toMatchObject({
        readers: 1,
        reads: 1,
        followers: 1,
        waitingFollowers: 1,
      });
      // Owned, never translated, never read: a zero row rather than an omission.
      expect(audience.novels[2]).toMatchObject({
        readers: 0,
        reads: 0,
        followers: 0,
        waitingFollowers: 0,
      });

      // The other owner's novel and its read are nowhere in this report.
      expect(audience.novels.map((row) => row.id)).not.toContain(fixture.novelIds.other);

      expect(audience.daily).toHaveLength(30);
      expect(audience.daily.reduce((sum, bucket) => sum + bucket.reads, 0)).toBe(5);

      // A week in which nobody finished anything: the read figures empty, the relations stay,
      // and the audience is still known to exist.
      const quiet = await getAccountAudienceForUser(fixture.ownerId, "7d", NOW);
      expect(quiet.totals).toMatchObject({
        readers: 0,
        reads: 0,
        followers: 3,
        waitingFollowers: 2,
        novels: 3,
        hasAnyReads: true,
      });
      expect(quiet.novels[0]).toMatchObject({
        readers: 0,
        reads: 0,
        followers: 2,
        waitingFollowers: 1,
      });
      expect(quiet.daily).toHaveLength(7);
      expect(quiet.daily.reduce((sum, bucket) => sum + bucket.reads, 0)).toBe(0);
    } finally {
      await cleanupAccount(fixture);
    }
  });

  it("answers the account rollup from the session's own novels only", async () => {
    const fixture = await seedAccount();
    try {
      const audience = await getAccountAudienceForUser(fixture.otherOwnerId, "30d", NOW);

      expect(audience.totals.novels).toBe(1);
      expect(audience.novels.map((row) => row.id)).toEqual([fixture.novelIds.other]);
      expect(audience.totals.followers).toBe(0);
      expect(audience.totals.waitingFollowers).toBe(0);
      // reader B finished a chapter of this novel, so it is the one read the account sees.
      expect(audience.totals).toMatchObject({ readers: 1, reads: 1, hasAnyReads: true });
    } finally {
      await cleanupAccount(fixture);
    }
  });

  it("answers only for the novel's owner", async () => {
    const fixture = await seed();
    try {
      await expect(
        getNovelAudienceForUser(fixture.readerA, fixture.novelId, "all", NOW),
      ).rejects.toMatchObject({ message: "errors.novelNotFoundOrUnauthorized" });
      await expect(
        getNovelAudienceForUser(fixture.otherOwnerId, fixture.novelId, "all", NOW),
      ).rejects.toMatchObject({ message: "errors.novelNotFoundOrUnauthorized" });
    } finally {
      await cleanup(fixture);
    }
  });
});
