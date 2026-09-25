import { z } from "zod";

export const READER_BOOKMARK_EXCERPT_MAX_LENGTH = 300;
export const READER_BOOKMARK_NOTE_MAX_LENGTH = 1000;
export const READER_BOOKMARK_PARAGRAPH_MAX_INDEX = 9999;

export const readerNovelSchema = z.object({
  novelId: z.string().min(1),
});

export const readerChapterSchema = z.object({
  novelId: z.string().min(1),
  chapterId: z.string().min(1),
});

export const saveReaderPositionSchema = readerChapterSchema.extend({
  scrollFraction: z.number().min(0).max(1),
});

export const createBookmarkSchema = readerChapterSchema.extend({
  paragraphIndex: z.number().int().min(0).max(READER_BOOKMARK_PARAGRAPH_MAX_INDEX),
  column: z.enum(["raw", "translated"]).nullable().default(null),
  excerpt: z.string().min(1).max(READER_BOOKMARK_EXCERPT_MAX_LENGTH),
  note: z.string().max(READER_BOOKMARK_NOTE_MAX_LENGTH).optional().nullable(),
});

export const updateBookmarkNoteSchema = z.object({
  bookmarkId: z.string().min(1),
  note: z.string().max(READER_BOOKMARK_NOTE_MAX_LENGTH).nullable(),
});

// The cursor carries the database's own timestamp text so fractional precision survives
// the round trip; the server also casts it back to a timestamp when binding the query.
export const READER_BOOKMARK_CURSOR_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

export const readerBookmarkCursorSchema = z.object({
  createdAt: z
    .string()
    .max(26)
    .regex(READER_BOOKMARK_CURSOR_TIMESTAMP_PATTERN, "Invalid bookmark cursor timestamp"),
  id: z.string().min(1),
});

export const listReaderBookmarksSchema = readerNovelSchema.extend({
  cursor: readerBookmarkCursorSchema.nullable().default(null),
});

export const deleteBookmarkSchema = z.object({
  bookmarkId: z.string().min(1),
});

export type ReaderChapterInput = z.input<typeof readerChapterSchema>;
export type SaveReaderPositionInput = z.input<typeof saveReaderPositionSchema>;
export type CreateBookmarkInput = z.input<typeof createBookmarkSchema>;
export type UpdateBookmarkNoteInput = z.input<typeof updateBookmarkNoteSchema>;
export type DeleteBookmarkInput = z.input<typeof deleteBookmarkSchema>;
export type ListReaderBookmarksInput = z.input<typeof listReaderBookmarksSchema>;
