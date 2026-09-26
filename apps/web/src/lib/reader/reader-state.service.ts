import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { lockNovelForMutation, type NovelMutationTransaction } from "@/lib/db/novel-lock";
import {
  chapters,
  novels,
  readerBookmarks,
  readerChapterReads,
  readerProgress,
} from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { NotFoundError, SafeServerError } from "@/lib/server-fn-error";
import type {
  ReaderBookmark,
  ReaderBookmarkCursor,
  ReaderBookmarkInput,
  ReaderBookmarkPage,
  ReaderColumn,
  ReaderNovelState,
} from "@pnt/contracts/reader";

function toReaderColumn(value: string | null): ReaderColumn | null {
  return value === "raw" || value === "translated" ? value : null;
}

export async function assertNovelOwnedByUser(userId: string, novelId: string): Promise<void> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) throw new NotFoundError("Novel not found or unauthorized");
}

export async function assertChapterOwnedByUser(
  userId: string,
  novelId: string,
  chapterId: string,
): Promise<void> {
  const [chapter] = await db
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(
      and(eq(chapters.id, chapterId), eq(chapters.novelId, novelId), eq(novels.userId, userId)),
    )
    .limit(1);

  if (!chapter) throw new NotFoundError("Chapter not found or unauthorized");
}

const READER_BOOKMARK_PAGE_SIZE = 200;

function toReaderBookmark(row: {
  id: string;
  chapterId: string;
  paragraphIndex: number;
  column: string | null;
  excerpt: string;
  note: string | null;
  createdAt: Date;
}): ReaderBookmark {
  return {
    id: row.id,
    chapterId: row.chapterId,
    paragraphIndex: row.paragraphIndex,
    column: toReaderColumn(row.column),
    excerpt: row.excerpt,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

// Keyset over (createdAt DESC, id DESC). The cursor holds database timestamp text, so it
// survives fractional precision, and it need not point at a row that still exists.
export async function getReaderBookmarksForUser(
  userId: string,
  novelId: string,
  cursor: ReaderBookmarkCursor | null,
): Promise<ReaderBookmarkPage> {
  const owned = and(eq(readerBookmarks.userId, userId), eq(readerBookmarks.novelId, novelId));
  const cursorAt = cursor ? sql`${cursor.createdAt}::timestamp` : null;
  const where =
    cursor && cursorAt
      ? and(
          owned,
          or(
            lt(readerBookmarks.createdAt, cursorAt),
            and(eq(readerBookmarks.createdAt, cursorAt), lt(readerBookmarks.id, cursor.id)),
          ),
        )
      : owned;

  const rows = await db
    .select({
      id: readerBookmarks.id,
      chapterId: readerBookmarks.chapterId,
      paragraphIndex: readerBookmarks.paragraphIndex,
      column: readerBookmarks.column,
      excerpt: readerBookmarks.excerpt,
      note: readerBookmarks.note,
      createdAt: readerBookmarks.createdAt,
      createdAtText: sql<string>`${readerBookmarks.createdAt}::text`,
    })
    .from(readerBookmarks)
    .where(where)
    .orderBy(desc(readerBookmarks.createdAt), desc(readerBookmarks.id))
    .limit(READER_BOOKMARK_PAGE_SIZE + 1);

  const page = rows.slice(0, READER_BOOKMARK_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    bookmarks: page.map(toReaderBookmark),
    nextCursor:
      rows.length > READER_BOOKMARK_PAGE_SIZE && last
        ? { createdAt: last.createdAtText, id: last.id }
        : null,
  };
}

export async function getReaderNovelStateForUser(
  userId: string,
  novelId: string,
): Promise<ReaderNovelState> {
  const [progressRows, readRows, bookmarkPage] = await Promise.all([
    db
      .select({
        lastChapterId: readerProgress.lastChapterId,
        scrollFraction: readerProgress.scrollFraction,
      })
      .from(readerProgress)
      .where(and(eq(readerProgress.userId, userId), eq(readerProgress.novelId, novelId)))
      .limit(1),
    db
      .select({ chapterId: readerChapterReads.chapterId })
      .from(readerChapterReads)
      .where(and(eq(readerChapterReads.userId, userId), eq(readerChapterReads.novelId, novelId)))
      .orderBy(asc(readerChapterReads.readAt)),
    getReaderBookmarksForUser(userId, novelId, null),
  ]);

  const progress = progressRows[0];

  return {
    lastChapterId: progress?.lastChapterId ?? null,
    scrollFraction: progress?.scrollFraction ?? null,
    readChapterIds: readRows.map((row) => row.chapterId),
    bookmarks: bookmarkPage.bookmarks,
    bookmarkNextCursor: bookmarkPage.nextCursor,
  };
}

async function lockReaderChapter(
  tx: NovelMutationTransaction,
  userId: string,
  novelId: string,
  chapterId: string,
  strength: "key share" | "update" = "key share",
): Promise<void> {
  if (!(await lockNovelForMutation(tx, novelId, userId))) {
    throw new NotFoundError("Chapter not found or unauthorized");
  }
  const [chapter] = await tx
    .select({ id: chapters.id })
    .from(chapters)
    .innerJoin(novels, eq(chapters.novelId, novels.id))
    .where(
      and(eq(chapters.id, chapterId), eq(chapters.novelId, novelId), eq(novels.userId, userId)),
    )
    .limit(1)
    .for(strength, { of: chapters });
  if (!chapter) throw new NotFoundError("Chapter not found or unauthorized");
}

// An omitted fraction opens the chapter; a supplied fraction is a delayed scroll sample.
async function upsertReaderPosition(
  tx: NovelMutationTransaction,
  userId: string,
  novelId: string,
  chapterId: string,
  scrollFraction?: number,
): Promise<void> {
  await tx
    .insert(readerProgress)
    .values({ userId, novelId, lastChapterId: chapterId, scrollFraction: scrollFraction ?? 0 })
    .onConflictDoUpdate({
      target: [readerProgress.userId, readerProgress.novelId],
      set: {
        lastChapterId:
          scrollFraction === undefined
            ? chapterId
            : sql`case when ${readerProgress.lastChapterId} = ${chapterId} then ${chapterId} else ${readerProgress.lastChapterId} end`,
        scrollFraction:
          scrollFraction === undefined
            ? sql`case when ${readerProgress.lastChapterId} = ${chapterId} then ${readerProgress.scrollFraction} else 0 end`
            : sql`case when ${readerProgress.lastChapterId} = ${chapterId} then ${scrollFraction} else ${readerProgress.scrollFraction} end`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      },
    });
}

// Opening a chapter keeps the saved fraction only when the reader was already there.
export async function setReaderChapterForUser(
  userId: string,
  novelId: string,
  chapterId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockReaderChapter(tx, userId, novelId, chapterId);
    await upsertReaderPosition(tx, userId, novelId, chapterId);
  });
}

// A throttled flush can land after the reader moved on, so a sample for any other
// chapter is dropped instead of overwriting the current position.
export async function saveReaderPositionForUser(
  userId: string,
  novelId: string,
  chapterId: string,
  scrollFraction: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockReaderChapter(tx, userId, novelId, chapterId);
    await upsertReaderPosition(tx, userId, novelId, chapterId, scrollFraction);
  });
}

export async function markReaderChapterReadForUser(
  userId: string,
  novelId: string,
  chapterId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockReaderChapter(tx, userId, novelId, chapterId);
    await tx
      .insert(readerChapterReads)
      .values({ userId, novelId, chapterId })
      .onConflictDoNothing();
    await upsertReaderPosition(tx, userId, novelId, chapterId);
  });
}

export async function createReaderBookmarkForUser(
  userId: string,
  novelId: string,
  input: ReaderBookmarkInput,
): Promise<{ id: string; duplicate: boolean }> {
  return db.transaction(async (tx) => {
    await lockReaderChapter(tx, userId, novelId, input.chapterId, "update");
    const [inserted] = await tx
      .insert(readerBookmarks)
      .values({
        id: nanoid(),
        userId,
        novelId,
        chapterId: input.chapterId,
        paragraphIndex: input.paragraphIndex,
        column: input.column,
        excerpt: input.excerpt,
        note: input.note ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: readerBookmarks.id });
    if (inserted) return { id: inserted.id, duplicate: false };

    const [existing] = await tx
      .select({ id: readerBookmarks.id })
      .from(readerBookmarks)
      .where(
        and(
          eq(readerBookmarks.userId, userId),
          eq(readerBookmarks.chapterId, input.chapterId),
          eq(readerBookmarks.paragraphIndex, input.paragraphIndex),
          sql`${readerBookmarks.column} is not distinct from ${input.column}`,
        ),
      )
      .orderBy(asc(readerBookmarks.createdAt), asc(readerBookmarks.id))
      .limit(1);
    if (!existing) {
      throw new SafeServerError("Bookmark changed while it was being saved; try again");
    }
    return { id: existing.id, duplicate: true };
  });
}

export async function updateReaderBookmarkNoteForUser(
  userId: string,
  bookmarkId: string,
  note: string | null,
): Promise<boolean> {
  const updated = await db
    .update(readerBookmarks)
    .set({ note })
    .where(and(eq(readerBookmarks.id, bookmarkId), eq(readerBookmarks.userId, userId)))
    .returning({ id: readerBookmarks.id });

  return updated.length > 0;
}

export async function deleteReaderBookmarkForUser(
  userId: string,
  bookmarkId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(readerBookmarks)
    .where(and(eq(readerBookmarks.id, bookmarkId), eq(readerBookmarks.userId, userId)))
    .returning({ id: readerBookmarks.id });

  return deleted.length > 0;
}
