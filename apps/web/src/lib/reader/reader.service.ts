import type {
  ReaderBookmarkCursor,
  ReaderBookmarkInput,
  ReaderBookmarkPage,
  ReaderNovelState,
} from "@pnt/contracts/reader";

import { SafeServerError } from "@/lib/server-fn-error";
import {
  assertChapterOwnedByUser,
  assertNovelOwnedByUser,
  createReaderBookmarkForUser,
  deleteReaderBookmarkForUser,
  getReaderBookmarksForUser,
  getReaderNovelStateForUser,
  markReaderChapterReadForUser,
  saveReaderPositionForUser,
  setReaderChapterForUser,
  updateReaderBookmarkNoteForUser,
} from "@/lib/reader/reader-state.service";

export async function getReaderStateForUser(
  userId: string,
  novelId: string,
): Promise<ReaderNovelState> {
  await assertNovelOwnedByUser(userId, novelId);
  return getReaderNovelStateForUser(userId, novelId);
}

export async function listReaderBookmarkPageForUser(
  userId: string,
  novelId: string,
  cursor: ReaderBookmarkCursor | null,
): Promise<ReaderBookmarkPage> {
  await assertNovelOwnedByUser(userId, novelId);
  return getReaderBookmarksForUser(userId, novelId, cursor);
}

export async function openReaderChapterForUser(userId: string, novelId: string, chapterId: string) {
  await assertChapterOwnedByUser(userId, novelId, chapterId);
  await setReaderChapterForUser(userId, novelId, chapterId);
  return { success: true };
}

export async function writeReaderPositionForUser(
  userId: string,
  novelId: string,
  chapterId: string,
  scrollFraction: number,
) {
  await assertChapterOwnedByUser(userId, novelId, chapterId);
  await saveReaderPositionForUser(userId, novelId, chapterId, scrollFraction);
  return { success: true };
}

export async function finishReaderChapterForUser(
  userId: string,
  novelId: string,
  chapterId: string,
) {
  await assertChapterOwnedByUser(userId, novelId, chapterId);
  await markReaderChapterReadForUser(userId, novelId, chapterId);
  return { success: true };
}

export async function addReaderBookmarkForUser(
  userId: string,
  novelId: string,
  input: ReaderBookmarkInput,
): Promise<{ id: string; duplicate: boolean }> {
  await assertChapterOwnedByUser(userId, novelId, input.chapterId);
  return createReaderBookmarkForUser(userId, novelId, input);
}

export async function editReaderBookmarkNoteForUser(
  userId: string,
  bookmarkId: string,
  note: string | null,
) {
  const updated = await updateReaderBookmarkNoteForUser(userId, bookmarkId, note);
  if (!updated) throw new SafeServerError("Bookmark not found");
  return { success: true };
}

export async function removeReaderBookmarkForUser(userId: string, bookmarkId: string) {
  const deleted = await deleteReaderBookmarkForUser(userId, bookmarkId);
  if (!deleted) throw new SafeServerError("Bookmark not found");
  return { success: true };
}
