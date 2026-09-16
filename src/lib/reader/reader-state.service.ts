import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chapters,
  novels,
  readerBookmarks,
  readerChapterReads,
  readerProgress,
} from "@/lib/db/schema";
import { nanoid } from "@/lib/utils";
import { SafeServerError } from "@/lib/server-fn-error";
import type { ReaderBookmark, ReaderBookmarkInput, ReaderColumn, ReaderNovelState } from "./types";

function toReaderColumn(value: string | null): ReaderColumn | null {
  return value === "raw" || value === "translated" ? value : null;
}

export async function assertNovelOwnedByUser(userId: string, novelId: string): Promise<void> {
  const [novel] = await db
    .select({ id: novels.id })
    .from(novels)
    .where(and(eq(novels.id, novelId), eq(novels.userId, userId)))
    .limit(1);

  if (!novel) throw new SafeServerError("Novel not found or unauthorized");
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

  if (!chapter) throw new SafeServerError("Chapter not found or unauthorized");
}

export async function getReaderNovelStateForUser(
  userId: string,
  novelId: string,
): Promise<ReaderNovelState> {
  const [progressRows, readRows, bookmarkRows] = await Promise.all([
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
    db
      .select({
        id: readerBookmarks.id,
        chapterId: readerBookmarks.chapterId,
        paragraphIndex: readerBookmarks.paragraphIndex,
        column: readerBookmarks.column,
        excerpt: readerBookmarks.excerpt,
        note: readerBookmarks.note,
        createdAt: readerBookmarks.createdAt,
      })
      .from(readerBookmarks)
      .where(and(eq(readerBookmarks.userId, userId), eq(readerBookmarks.novelId, novelId)))
      .orderBy(desc(readerBookmarks.createdAt))
      .limit(200),
  ]);

  const progress = progressRows[0];
  const bookmarks: ReaderBookmark[] = bookmarkRows.map((row) => ({
    id: row.id,
    chapterId: row.chapterId,
    paragraphIndex: row.paragraphIndex,
    column: toReaderColumn(row.column),
    excerpt: row.excerpt,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }));

  return {
    lastChapterId: progress?.lastChapterId ?? null,
    scrollFraction: progress?.scrollFraction ?? null,
    readChapterIds: readRows.map((row) => row.chapterId),
    bookmarks,
  };
}

// Opening a chapter keeps the saved fraction only when the reader was already there.
export async function setReaderChapterForUser(
  userId: string,
  novelId: string,
  chapterId: string,
): Promise<void> {
  await db
    .insert(readerProgress)
    .values({ userId, novelId, lastChapterId: chapterId, scrollFraction: 0 })
    .onConflictDoUpdate({
      target: [readerProgress.userId, readerProgress.novelId],
      set: {
        lastChapterId: chapterId,
        scrollFraction: sql`case when ${readerProgress.lastChapterId} = ${chapterId} then ${readerProgress.scrollFraction} else 0 end`,
        updatedAt: sql`now()`,
      },
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
  await db
    .insert(readerProgress)
    .values({ userId, novelId, lastChapterId: chapterId, scrollFraction })
    .onConflictDoUpdate({
      target: [readerProgress.userId, readerProgress.novelId],
      set: {
        lastChapterId: sql`case when ${readerProgress.lastChapterId} = ${chapterId} then ${chapterId} else ${readerProgress.lastChapterId} end`,
        scrollFraction: sql`case when ${readerProgress.lastChapterId} = ${chapterId} then ${scrollFraction} else ${readerProgress.scrollFraction} end`,
        updatedAt: sql`now()`,
      },
    });
}

export async function markReaderChapterReadForUser(
  userId: string,
  novelId: string,
  chapterId: string,
): Promise<void> {
  await db.insert(readerChapterReads).values({ userId, novelId, chapterId }).onConflictDoNothing();
  await setReaderChapterForUser(userId, novelId, chapterId);
}

export async function createReaderBookmarkForUser(
  userId: string,
  novelId: string,
  input: ReaderBookmarkInput,
): Promise<{ id: string; duplicate: boolean }> {
  // One bookmark per spot: re-bookmarking the same paragraph returns the existing row so
  // repeated clicks cannot pile up identical entries.
  const [existing] = await db
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
    .limit(1);

  if (existing) return { id: existing.id, duplicate: true };

  const bookmarkId = nanoid();

  await db.insert(readerBookmarks).values({
    id: bookmarkId,
    userId,
    novelId,
    chapterId: input.chapterId,
    paragraphIndex: input.paragraphIndex,
    column: input.column,
    excerpt: input.excerpt,
    note: input.note ?? null,
  });

  return { id: bookmarkId, duplicate: false };
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
