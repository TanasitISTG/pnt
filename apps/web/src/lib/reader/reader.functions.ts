import { createServerFn } from "@tanstack/react-start";

import {
  createBookmarkSchema,
  deleteBookmarkSchema,
  listReaderBookmarksSchema,
  readerChapterSchema,
  readerNovelSchema,
  saveReaderPositionSchema,
  updateBookmarkNoteSchema,
} from "@pnt/contracts/reader-inputs";

import { ensureSession } from "@/lib/auth/functions";
import { withSafeHandler } from "@/lib/server-fn-error";
import {
  addReaderBookmarkForUser,
  editReaderBookmarkNoteForUser,
  finishReaderChapterForUser,
  getReaderStateForUser,
  listReaderBookmarkPageForUser,
  openReaderChapterForUser,
  removeReaderBookmarkForUser,
  writeReaderPositionForUser,
} from "@/lib/reader/reader.service";

export const getReaderNovelState = createServerFn({ method: "GET" })
  .validator(readerNovelSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return getReaderStateForUser(session.user.id, data.novelId);
    });
  });

export const getReaderBookmarks = createServerFn({ method: "GET" })
  .validator(listReaderBookmarksSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return listReaderBookmarkPageForUser(session.user.id, data.novelId, data.cursor);
    });
  });

export const setReaderChapter = createServerFn({ method: "POST" })
  .validator(readerChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return openReaderChapterForUser(session.user.id, data.novelId, data.chapterId);
    });
  });

export const saveReaderPosition = createServerFn({ method: "POST" })
  .validator(saveReaderPositionSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return writeReaderPositionForUser(
        session.user.id,
        data.novelId,
        data.chapterId,
        data.scrollFraction,
      );
    });
  });

export const markReaderChapterRead = createServerFn({ method: "POST" })
  .validator(readerChapterSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return finishReaderChapterForUser(session.user.id, data.novelId, data.chapterId);
    });
  });

export const createBookmark = createServerFn({ method: "POST" })
  .validator(createBookmarkSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return addReaderBookmarkForUser(session.user.id, data.novelId, data);
    });
  });

export const updateBookmarkNote = createServerFn({ method: "POST" })
  .validator(updateBookmarkNoteSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return editReaderBookmarkNoteForUser(session.user.id, data.bookmarkId, data.note);
    });
  });

export const deleteBookmark = createServerFn({ method: "POST" })
  .validator(deleteBookmarkSchema)
  .handler(async ({ data }) => {
    return withSafeHandler(async () => {
      const session = await ensureSession();
      return removeReaderBookmarkForUser(session.user.id, data.bookmarkId);
    });
  });
