import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";

import type {
  createReaderBookmarkForUser as CreateReaderBookmarkForUser,
  deleteReaderBookmarkForUser as DeleteReaderBookmarkForUser,
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
let setReaderChapterForUser: typeof SetReaderChapterForUser;
let saveReaderPositionForUser: typeof SaveReaderPositionForUser;
let markReaderChapterReadForUser: typeof MarkReaderChapterReadForUser;
let createReaderBookmarkForUser: typeof CreateReaderBookmarkForUser;
let updateReaderBookmarkNoteForUser: typeof UpdateReaderBookmarkNoteForUser;
let deleteReaderBookmarkForUser: typeof DeleteReaderBookmarkForUser;

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

integrationDescribe("reader state service", () => {
  beforeAll(async () => {
    sql = postgres(testDatabaseUrl as string, { max: 1 });
    ({ getReaderNovelStateForUser } = await import("@/lib/reader/reader-state.service"));
    ({ setReaderChapterForUser } = await import("@/lib/reader/reader-state.service"));
    ({ saveReaderPositionForUser } = await import("@/lib/reader/reader-state.service"));
    ({ markReaderChapterReadForUser } = await import("@/lib/reader/reader-state.service"));
    ({ createReaderBookmarkForUser } = await import("@/lib/reader/reader-state.service"));
    ({ updateReaderBookmarkNoteForUser } = await import("@/lib/reader/reader-state.service"));
    ({ deleteReaderBookmarkForUser } = await import("@/lib/reader/reader-state.service"));
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
    });
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
    });
  });

  it("returns the existing bookmark instead of duplicating the same spot", async () => {
    const fixture = await seedReaderFixture();
    const spot = {
      chapterId: fixture.chapterIds[0],
      paragraphIndex: 4,
      column: null,
      excerpt: "same spot",
      note: null,
    };

    const first = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, spot);
    const second = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, spot);

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, duplicate: true });

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
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
    const translatedAgain = await createReaderBookmarkForUser(fixture.userId, fixture.novelId, {
      ...base,
      column: "translated",
    });

    expect(pairLevel.duplicate).toBe(false);
    expect(translated.duplicate).toBe(false);
    expect(translatedAgain).toEqual({ id: translated.id, duplicate: true });

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.bookmarks).toHaveLength(2);
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
    await new Promise((resolve) => setTimeout(resolve, 10));
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

    await sql`DELETE FROM "chapters" WHERE "id" = ${fixture.chapterIds[0]}`;

    const state = await getReaderNovelStateForUser(fixture.userId, fixture.novelId);
    expect(state.readChapterIds).toEqual([]);
    expect(state.bookmarks).toEqual([]);

    await sql`DELETE FROM "novels" WHERE "id" = ${fixture.novelId}`;
    expect(
      await sql`SELECT count(*)::int AS count FROM "reader_progress" WHERE "novel_id" = ${fixture.novelId}`,
    ).toMatchObject([{ count: 0 }]);
  });
});
