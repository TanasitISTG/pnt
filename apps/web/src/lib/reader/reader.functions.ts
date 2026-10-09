import { createServerFn } from "@tanstack/react-start";

import { ensureSession } from "@/lib/auth/functions";
import { SafeServerError, withSafeHandler } from "@/lib/server-fn-error";
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
import {
  createBookmarkSchema,
  deleteBookmarkSchema,
  listReaderBookmarksSchema,
  readerChapterSchema,
  readerNovelSchema,
  saveReaderPositionSchema,
  updateBookmarkNoteSchema,
} from "@/lib/reader/reader.schemas";

export const getReaderNovelState = createServerFn({ method: "GET" })
  .validator(readerNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      await assertNovelOwnedByUser(session.user.id, data.novelId);
      return getReaderNovelStateForUser(session.user.id, data.novelId);
    });
  });

export const getReaderBookmarks = createServerFn({ method: "GET" })
  .validator(listReaderBookmarksSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      await assertNovelOwnedByUser(session.user.id, data.novelId);
      return getReaderBookmarksForUser(session.user.id, data.novelId, data.cursor);
    });
  });

export const setReaderChapter = createServerFn({ method: "POST" })
  .validator(readerChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      await assertChapterOwnedByUser(session.user.id, data.novelId, data.chapterId);
      await setReaderChapterForUser(session.user.id, data.novelId, data.chapterId);
      return { success: true };
    });
  });

export const saveReaderPosition = createServerFn({ method: "POST" })
  .validator(saveReaderPositionSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      await assertChapterOwnedByUser(session.user.id, data.novelId, data.chapterId);
      await saveReaderPositionForUser(
        session.user.id,
        data.novelId,
        data.chapterId,
        data.scrollFraction,
      );
      return { success: true };
    });
  });

export const markReaderChapterRead = createServerFn({ method: "POST" })
  .validator(readerChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      await assertChapterOwnedByUser(session.user.id, data.novelId, data.chapterId);
      await markReaderChapterReadForUser(session.user.id, data.novelId, data.chapterId);
      return { success: true };
    });
  });

export const createBookmark = createServerFn({ method: "POST" })
  .validator(createBookmarkSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      await assertChapterOwnedByUser(session.user.id, data.novelId, data.chapterId);
      return createReaderBookmarkForUser(session.user.id, data.novelId, data);
    });
  });

export const updateBookmarkNote = createServerFn({ method: "POST" })
  .validator(updateBookmarkNoteSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      const updated = await updateReaderBookmarkNoteForUser(
        session.user.id,
        data.bookmarkId,
        data.note,
      );
      if (!updated) throw new SafeServerError("Bookmark not found");
      return { success: true };
    });
  });

export const deleteBookmark = createServerFn({ method: "POST" })
  .validator(deleteBookmarkSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      const deleted = await deleteReaderBookmarkForUser(session.user.id, data.bookmarkId);
      if (!deleted) throw new SafeServerError("Bookmark not found");
      return { success: true };
    });
  });
