import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres, { type Sql } from "postgres";
import type { deleteChapterForUser as DeleteChapterForUser } from "@/lib/content/chapter/chapter-delete.service";
import type { db as Db } from "@/lib/db";
import { sql as drizzleSql } from "drizzle-orm";

import {
  READER_BOOKMARK_CURSOR_TIMESTAMP_PATTERN,
  listReaderBookmarksSchema,
} from "@pnt/contracts/reader-inputs";

import type {
  createReaderBookmarkForUser as CreateReaderBookmarkForUser,
  deleteReaderBookmarkForUser as DeleteReaderBookmarkForUser,
  getReaderBookmarksForUser as GetReaderBookmarksForUser,
  getReaderNovelStateForUser as GetReaderNovelStateForUser,
  markReaderChapterReadForUser as MarkReaderChapterReadForUser,
  saveReaderPositionForUser as SaveReaderPositionForUser,
  setReaderChapterForUser as SetReaderChapterForUser,
  updateReaderBookmarkNoteForUser as UpdateReaderBookmarkNoteForUser,
} from "@/lib/reader/reader-state.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationDescribe = testDatabaseUrl ? describe : describe.skip;

let sql: Sql;
let getReaderNovelStateForUser: typeof GetReaderNovelStateForUser;
let getReaderBookmarksForUser: typeof GetReaderBookmarksForUser;
let setReaderChapterForUser: typeof SetReaderChapterForUser;
let saveReaderPositionForUser: typeof SaveReaderPositionForUser;
let markReaderChapterReadForUser: typeof MarkReaderChapterReadForUser;
let createReaderBookmarkForUser: typeof CreateReaderBookmarkForUser;
let updateReaderBookmarkNoteForUser: typeof UpdateReaderBookmarkNoteForUser;
let deleteReaderBookmarkForUser: typeof DeleteReaderBookmarkForUser;
let deleteChapterForUser: typeof DeleteChapterForUser;
let db: typeof Db;

type ReaderFixture = {
  userId: string;
  otherUserId: string;
  novelId: string;
  otherNovelId: string;
  chapterIds: string[];
};

async function seedReaderFixture(): Promise<ReaderFixture> {
  const userId = `user-${randomUUID()}`;
  const otherUserId = `user-${randomUUID()}`;
  const novelId = `novel-${randomUUID()}`;
  const otherNovelId = `novel-${randomUUID()}`;
  const chapterIds = [1, 2, 3].map(() => `chapter-${randomUUID()}`);

  await sql`
    INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
    VALUES
      (${userId}, 'Reader', ${`${userId}@example.test`}, true, now(), now()),
      (${otherUserId}, 'Other Reader', ${`${otherUserId}@example.test`}, true, now(), now())
  `;
  await sql`
    INSERT INTO "novels" (
      "id", "user_id", "title", "source_lang", "target_lang", "story_summary", "created_at", "updated_at"
    ) VALUES
      (${novelId}, ${userId}, 'Reader Novel', 'en', 'th', 'Summary', now(), now()),
      (${otherNovelId}, ${otherUserId}, 'Other Novel', 'en', 'th', 'Summary', now(), now())
  `;
  await sql`
    INSERT INTO "chapters" (
      "id", "novel_id", "number", "title", "raw_content", "status",
      "raw_char_count", "source_revision", "translation_generation", "created_at", "updated_at"
    ) VALUES
      (${chapterIds[0]}, ${novelId}, 1, 'One', 'Raw one', 'raw', 7, 1, 0, now(), now()),
      (${chapterIds[1]}, ${novelId}, 2, 'Two', 'Raw two', 'raw', 7, 1, 0, now(), now()),
      (${chapterIds[2]}, ${novelId}, 3, 'Three', 'Raw three', 'raw', 9, 1, 0, now(), now())
  `;

  return { userId, otherUserId, novelId, otherNovelId, chapterIds };
}

async function readProgress(userId: string, novelId: string) {
  const [row] = await sql<{ last_chapter_id: string | null; scroll_fraction: number }[]>`
    SELECT "last_chapter_id", "scroll_fraction" FROM "reader_progress"
    WHERE "user_id" = ${userId} AND "novel_id" = ${novelId}
  `;
  return row;
}

// One shared timestamp for every row so equal keys span the page boundary and only the id
// tie-breaker can keep the keyset walk deterministic.
async function seedBookmarks(
  userId: string,
  novelId: string,
  chapterId: string,
  count: number,
): Promise<void> {
  await sql`
    INSERT INTO "reader_bookmarks" (
      "id", "user_id", "novel_id", "chapter_id", "paragraph_index", "source_column",
      "excerpt", "note", "created_at"
    )
    SELECT
      ${chapterId} || '-bm-' || lpad(series::text, 4, '0'), ${userId}, ${novelId}, ${chapterId}, series, NULL,
      'excerpt ' || series, NULL, TIMESTAMP '2026-01-01 00:00:00'
    FROM generate_series(1, ${count}) AS series
  `;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  // Real timeout only bounds a failed database barrier; transaction ordering uses signals.
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Reader transaction barrier timed out")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function pauseNextNovelGate() {
  const acquired = deferred();
  const released = deferred();
  const transaction = db.transaction.bind(db);
  let claimed = false;
  let holderPid = 0;
  const wrapper = vi.spyOn(db, "transaction").mockImplementation((callback, config) =>
    transaction(async (tx) => {
      const [{ pid }] = await tx.execute<{ pid: number }>(
        drizzleSql`select pg_backend_pid() as pid`,
      );
      const originalSelect = tx.select;
      // Preserve the actual builders, SQL execution, rows and transaction connection.
      tx.select = new Proxy(originalSelect, {
        apply(select, _thisArg, args) {
          const builder: ReturnType<typeof originalSelect> = Reflect.apply(select, tx, args);
          const originalFrom = builder.from;
          builder.from = new Proxy(originalFrom, {
            apply(from, _fromThis, fromArgs) {
              const query: ReturnType<typeof originalFrom> = Reflect.apply(from, builder, fromArgs);
              const originalExecute = query.execute;
              query.execute = new Proxy(originalExecute, {
                async apply(execute, _executeThis, executeArgs) {
                  const rows = await Reflect.apply(execute, query, executeArgs);
                  if (!claimed && /for update of "novels"\s*$/i.test(query.toSQL().sql)) {
                    claimed = true;
                    holderPid = pid;
                    acquired.resolve();
                    await bounded(released.promise);
                  }
                  return rows;
                },
              });
              return query;
            },
          });
          return builder;
        },
      });
      return callback(tx);
    }, config),
  );
  return {
    acquired: acquired.promise,
    release: released.resolve,
    holderPid: () => holderPid,
    restore: () => wrapper.mockRestore(),
  };
}

async function waitForNovelLockWaiter(holderPid: number): Promise<void> {
  // This real deadline bounds observer failure; it never chooses the winner.
  const deadline = AbortSignal.timeout(5000);
  for (;;) {
    deadline.throwIfAborted();
    const [state] = await sql<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity AS waiting
        WHERE waiting.datname = current_database()
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query LIKE '%for update of "novels"%'
          AND ${holderPid} = ANY(pg_blocking_pids(waiting.pid))
      ) AS waiting
    `;
    if (state.waiting) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

integrationDescribe("reader state service", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    // Load server modules only after isolating their database connection from application data.
    sql = postgres(testDatabaseUrl as string, { max: 1 });
    ({ db } = await import("@/lib/db"));
    ({ getReaderNovelStateForUser } = await import("@/lib/reader/reader-state.service"));
    ({ getReaderBookmarksForUser } = await import("@/lib/reader/reader-state.service"));
    ({ setReaderChapterForUser } = await import("@/lib/reader/reader-state.service"));
    ({ saveReaderPositionForUser } = await import("@/lib/reader/reader-state.service"));
    ({ markReaderChapterReadForUser } = await import("@/lib/reader/reader-state.service"));
    ({ createReaderBookmarkForUser } = await import("@/lib/reader/reader-state.service"));
    ({ updateReaderBookmarkNoteForUser } = await import("@/lib/reader/reader-state.service"));
    ({ deleteReaderBookmarkForUser } = await import("@/lib/reader/reader-state.service"));
    ({ deleteChapterForUser } = await import("@/lib/content/chapter/chapter-delete.service"));
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("reports an empty state for a novel the user never read", async () => {
    const fixture = await seedReaderFixture();

    expect(await getReaderNovelStateForUser(fixture.userId, fixture.novelId)).toEqual({
      lastChapterId: null,
      scrollFraction: null,
      readChapterIds: [],
      bookmarks: [],
      bookmarkNextCursor: null,
    });
  });

  it("inserts the initial saved position without requiring an earlier open", async () => {
    const fixture = await seedReaderFixture();
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0], 0.25);
    expect(await readProgress(fixture.userId, fixture.novelId)).toMatchObject({
      last_chapter_id: fixture.chapterIds[0],
      scroll_fraction: 0.25,
    });
  });

  it("rejects foreign ownership and mismatched novel/chapter links before reader writes", async () => {
    const fixture = await seedReaderFixture();
    for (const [userId, novelId] of [
      [fixture.otherUserId, fixture.novelId],
      [fixture.otherUserId, fixture.otherNovelId],
    ]) {
      await expect(setReaderChapterForUser(userId, novelId, fixture.chapterIds[0])).rejects.toThrow(
        "Chapter not found or unauthorized",
      );
      await expect(
        saveReaderPositionForUser(userId, novelId, fixture.chapterIds[0], 0.5),
      ).rejects.toThrow("Chapter not found or unauthorized");
      await expect(
        markReaderChapterReadForUser(userId, novelId, fixture.chapterIds[0]),
      ).rejects.toThrow("Chapter not found or unauthorized");
      await expect(
        createReaderBookmarkForUser(userId, novelId, {
          chapterId: fixture.chapterIds[0],
          paragraphIndex: 0,
          column: null,
          excerpt: "foreign",
          note: "do not write",
        }),
      ).rejects.toThrow("Chapter not found or unauthorized");
      expect(await getReaderNovelStateForUser(userId, novelId)).toEqual({
        lastChapterId: null,
        scrollFraction: null,
        readChapterIds: [],
        bookmarks: [],
        bookmarkNextCursor: null,
      });
    }
  });

  it("keeps the saved fraction when the same chapter is reopened", async () => {
    const fixture = await seedReaderFixture();

    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0], 0.42);
    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);

    const progress = await readProgress(fixture.userId, fixture.novelId);
    expect(progress.last_chapter_id).toBe(fixture.chapterIds[0]);
    expect(progress.scroll_fraction).toBeCloseTo(0.42, 4);
  });

  it("resets the fraction when the reader moves to another chapter", async () => {
    const fixture = await seedReaderFixture();

    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0], 0.8);
    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[1]);

    expect(await readProgress(fixture.userId, fixture.novelId)).toMatchObject({
      last_chapter_id: fixture.chapterIds[1],
      scroll_fraction: 0,
    });
  });

  it("drops a scroll sample that arrives after the reader left the chapter", async () => {
    const fixture = await seedReaderFixture();

    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[1]);
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0], 0.9);

    expect(await readProgress(fixture.userId, fixture.novelId)).toMatchObject({
      last_chapter_id: fixture.chapterIds[1],
      scroll_fraction: 0,
    });
  });

  it("records a scroll sample for the chapter the reader is on", async () => {
    const fixture = await seedReaderFixture();

    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[1]);
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[1], 0.35);
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[1], 0.6);

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.lastChapterId).toBe(fixture.chapterIds[1]);
    expect(state.scrollFraction).toBeCloseTo(0.6, 5);
  });

  it("marks a chapter read exactly once and keeps the previous fraction", async () => {
    const fixture = await seedReaderFixture();

    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0], 0.5);
    await markReaderChapterReadForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await markReaderChapterReadForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);

    const [readRow] = await sql<{ count: string }[]>`
      SELECT count(*) FROM "reader_chapter_reads"
      WHERE "user_id" = ${fixture.userId} AND "chapter_id" = ${fixture.chapterIds[0]}
    `;
    expect(Number(readRow.count)).toBe(1);

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.readChapterIds).toEqual([fixture.chapterIds[0]]);
    expect(state.scrollFraction).toBeCloseTo(0.5, 5);
  });

  it("keeps progress and bookmarks apart per user and per novel", async () => {
    const fixture = await seedReaderFixture();

    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await markReaderChapterReadForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 4,
      column: "translated",
      excerpt: "remember me",
      note: null,
    });

    const otherState = await getReaderNovelStateForUser(fixture.otherUserId, fixture.otherNovelId);
    expect(otherState).toEqual({
      lastChapterId: null,
      scrollFraction: null,
      readChapterIds: [],
      bookmarks: [],
      bookmarkNextCursor: null,
    });
  });

  it("returns the existing bookmark instead of duplicating the same spot", async () => {
    const fixture = await seedReaderFixture();
    const spot = {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 4,
      column: null,
      excerpt: "same spot",
      note: "original note",
    };

    const first = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, spot);
    const second = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      ...spot,
      excerpt: "replacement excerpt",
      note: "replacement note",
    });

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, duplicate: true });

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.bookmarks).toHaveLength(1);
    expect(state.bookmarks[0]).toMatchObject({ excerpt: "same spot", note: "original note" });
  });

  it("atomically returns one bookmark winner for concurrent same-spot creation", async () => {
    const fixture = await seedReaderFixture();
    const spot = {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 0,
      column: null,
      excerpt: "same spot",
    };
    const results = await Promise.all([
      createReaderBookmarkForUser(fixture.userId, fixture.novelId, { ...spot, note: "first note" }),
      createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
        ...spot,
        note: "second note",
      }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results.map(({ duplicate }) => duplicate).sort()).toEqual([false, true]);
    const winnerIndex = results.findIndex(({ duplicate }) => !duplicate);
    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.bookmarks).toMatchObject([
      {
        id: results[winnerIndex].id,
        note: winnerIndex === 0 ? "first note" : "second note",
      },
    ]);
    expect(state.bookmarks).toHaveLength(1);
  });

  it("treats the other column of the same paragraph as its own spot", async () => {
    const fixture = await seedReaderFixture();
    const base = {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 4,
      excerpt: "excerpt",
      note: null,
    };

    const pairLevel = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      ...base,
      column: null,
    });
    const translated = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      ...base,
      column: "translated",
    });
    const raw = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      ...base,
      column: "raw",
    });
    const translatedAgain = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      ...base,
      column: "translated",
    });

    expect(pairLevel.duplicate).toBe(false);
    expect(translated.duplicate).toBe(false);
    expect(raw.duplicate).toBe(false);
    expect(translatedAgain).toEqual({ id: translated.id, duplicate: true });

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.bookmarks).toHaveLength(3);
  });

  it("returns bookmarks newest first with their note and column", async () => {
    const fixture = await seedReaderFixture();

    const first = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 1,
      column: null,
      excerpt: "older",
      note: "keep this",
    });
    await sql`UPDATE "reader_bookmarks" SET "created_at" = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE "id" = ${first.id}`;
    await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      chapterId: fixture.chapterIds[1],
      paragraphIndex: 2,
      column: "raw",
      excerpt: "newer",
      note: null,
    });

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.bookmarks.map((bookmark) => bookmark.excerpt)).toEqual(["newer", "older"]);
    expect(state.bookmarks[1]).toMatchObject({ id: first.id, note: "keep this", column: null });
    expect(state.bookmarks[0].column).toBe("raw");
    expect(typeof state.bookmarks[0].createdAt).toBe("string");
  });

  it("walks the whole bookmark list once across equal timestamps", async () => {
    const fixture = await seedReaderFixture();
    const total = 405;
    await seedBookmarks(fixture.userId, fixture.novelId, fixture.chapterIds[0], total);

    const collected: string[] = [];
    const pageSizes: number[] = [];
    let cursor: { createdAt: string; id: string } | null = null;
    for (let page = 0; page < 3; page += 1) {
      const result = await getReaderBookmarksForUser(fixture.userId, fixture.novelId, cursor);
      pageSizes.push(result.bookmarks.length);
      collected.push(...result.bookmarks.map((bookmark) => bookmark.id));
      cursor = result.nextCursor;
    }

    expect(pageSizes).toEqual([200, 200, 5]);
    expect(cursor).toBeNull();
    expect(new Set(collected).size).toBe(total);
    expect(collected).toEqual(
      Array.from(
        { length: total },
        (_, index) => `${fixture.chapterIds[0]}-bm-${String(total - index).padStart(4, "0")}`,
      ),
    );
  });

  it("emits a cursor the request validator accepts", async () => {
    const fixture = await seedReaderFixture();
    await seedBookmarks(fixture.userId, fixture.novelId, fixture.chapterIds[0], 201);

    const page = await getReaderBookmarksForUser(fixture.userId, fixture.novelId, null);

    expect(page.bookmarks).toHaveLength(200);
    expect(page.nextCursor).toEqual({
      createdAt: "2026-01-01 00:00:00",
      id: `${fixture.chapterIds[0]}-bm-0002`,
    });
    expect(page.nextCursor?.createdAt).toMatch(READER_BOOKMARK_CURSOR_TIMESTAMP_PATTERN);
    expect(
      listReaderBookmarksSchema.safeParse({
        novelId: fixture.novelId,
        cursor: page.nextCursor,
      }).success,
    ).toBe(true);
  });

  it("continues past a cursor whose bookmark was deleted", async () => {
    const fixture = await seedReaderFixture();
    await seedBookmarks(fixture.userId, fixture.novelId, fixture.chapterIds[0], 205);

    const firstPage = await getReaderBookmarksForUser(fixture.userId, fixture.novelId, null);
    const cursor = firstPage.nextCursor;
    expect(cursor).not.toBeNull();
    if (!cursor) return;

    await sql`DELETE FROM "reader_bookmarks" WHERE "id" = ${cursor.id}`;
    const secondPage = await getReaderBookmarksForUser(fixture.userId, fixture.novelId, cursor);

    expect(secondPage.bookmarks.map((bookmark) => bookmark.id)).toEqual([
      `${fixture.chapterIds[0]}-bm-0005`,
      `${fixture.chapterIds[0]}-bm-0004`,
      `${fixture.chapterIds[0]}-bm-0003`,
      `${fixture.chapterIds[0]}-bm-0002`,
      `${fixture.chapterIds[0]}-bm-0001`,
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("scopes continuation pages to the owning user and novel", async () => {
    const fixture = await seedReaderFixture();
    await seedBookmarks(fixture.userId, fixture.novelId, fixture.chapterIds[0], 205);
    // Equal timestamps make the first page's cursor deterministic: the 200th emitted row.
    const cursor = { createdAt: "2026-01-01 00:00:00", id: `${fixture.chapterIds[0]}-bm-0006` };

    expect(await getReaderBookmarksForUser(fixture.userId, fixture.otherNovelId, null)).toEqual({
      bookmarks: [],
      nextCursor: null,
    });
    expect(await getReaderBookmarksForUser(fixture.otherUserId, fixture.novelId, cursor)).toEqual({
      bookmarks: [],
      nextCursor: null,
    });
  });

  it("scopes bookmark writes to their owner", async () => {
    const fixture = await seedReaderFixture();
    const { id } = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 0,
      column: null,
      excerpt: "owned",
      note: null,
    });

    expect(await updateReaderBookmarkNoteForUser(fixture.otherUserId, id, "hijacked")).toBe(false);
    expect(await deleteReaderBookmarkForUser(fixture.otherUserId, id)).toBe(false);

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.bookmarks[0].note).toBeNull();

    expect(await updateReaderBookmarkNoteForUser(fixture.userId, id, "mine")).toBe(true);
    expect(await deleteReaderBookmarkForUser(fixture.userId, id)).toBe(true);
    expect((await getReaderNovelStateForUser(fixture.userId, fixture.novelId)).bookmarks).toEqual(
      [],
    );
  });
  it.each(["save", "delete"] as const)(
    "keeps a deleted pointer cleared when %s wins the novel gate",
    async (winner) => {
      const fixture = await seedReaderFixture();
      const unrelated = await seedReaderFixture();
      await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
      await setReaderChapterForUser(unrelated.userId, unrelated.novelId, unrelated.chapterIds[0]);
      await saveReaderPositionForUser(
        unrelated.userId,
        unrelated.novelId,
        unrelated.chapterIds[0],
        0.25,
      );
      const gate = pauseNextNovelGate();
      const save = () =>
        saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0], 0.75);
      const remove = () =>
        deleteChapterForUser(fixture.userId, fixture.chapterIds[0], async () => {});
      const first = winner === "save" ? save() : remove();
      const outcomes: Promise<unknown>[] = [first];
      // Attach rejection handling immediately, even if the observer fails before release.
      void first.catch(() => {});
      try {
        await bounded(gate.acquired);
        const second = winner === "save" ? remove() : save();
        outcomes.push(second);
        void second.catch(() => {});
        await waitForNovelLockWaiter(gate.holderPid());
        gate.release();
        const [firstResult, secondResult] = await bounded(Promise.allSettled(outcomes));
        expect(firstResult.status).toBe("fulfilled");
        if (winner === "save") {
          expect(secondResult.status).toBe("fulfilled");
        } else {
          expect(secondResult).toMatchObject({
            status: "rejected",
            reason: expect.objectContaining({ message: "Chapter not found or unauthorized" }),
          });
        }
        expect(await readProgress(fixture.userId, fixture.novelId)).toMatchObject({
          last_chapter_id: null,
          scroll_fraction: 0,
        });
        expect(await readProgress(unrelated.userId, unrelated.novelId)).toMatchObject({
          last_chapter_id: unrelated.chapterIds[0],
          scroll_fraction: 0.25,
        });
      } finally {
        gate.release();
        try {
          await bounded(Promise.allSettled(outcomes));
        } finally {
          gate.restore();
        }
      }
    },
  );

  it("preserves another chapter's saved position and read mark during deletion", async () => {
    const fixture = await seedReaderFixture();
    await markReaderChapterReadForUser(fixture.userId, fixture.novelId, fixture.chapterIds[1]);
    await saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[1], 0.5);
    await deleteChapterForUser(fixture.userId, fixture.chapterIds[0], async () => {});
    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.lastChapterId).toBe(fixture.chapterIds[1]);
    expect(state.scrollFraction).toBe(0.5);
    expect(state.readChapterIds).toEqual([fixture.chapterIds[1]]);
  });

  it("removes reader state when the novel or chapter is deleted", async () => {
    const fixture = await seedReaderFixture();

    await setReaderChapterForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await markReaderChapterReadForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0]);
    await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 0,
      column: null,
      excerpt: "cascade",
      note: null,
    });

    await deleteChapterForUser(fixture.userId, fixture.chapterIds[0], async () => {});

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.readChapterIds).toEqual([]);
    expect(state.bookmarks).toEqual([]);
    expect(state.lastChapterId).toBeNull();
    expect(state.scrollFraction).toBe(0);
    await expect(
      saveReaderPositionForUser(fixture.userId, fixture.novelId, fixture.chapterIds[0], 0.8),
    ).rejects.toThrow("Chapter not found or unauthorized");
    expect(await readProgress(fixture.userId, fixture.novelId)).toMatchObject({
      last_chapter_id: null,
      scroll_fraction: 0,
    });

    await sql`DELETE FROM "novels" WHERE "id" = ${fixture.novelId}`;
    expect(
      await sql`SELECT count(*)::int AS count FROM "reader_progress" WHERE "novel_id" = ${fixture.novelId}`,
    ).toMatchObject([{ count: 0 }]);
  });
});
