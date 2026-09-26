import { z } from "zod";
import {
  readerBookmarkCursorSchema,
  READER_BOOKMARK_EXCERPT_MAX_LENGTH,
  READER_BOOKMARK_NOTE_MAX_LENGTH,
  READER_BOOKMARK_PARAGRAPH_MAX_INDEX,
} from "./reader-inputs";
import { bookmarkIdSchema, chapterIdSchema } from "./content";

export const bookmarkV1Schema = z.strictObject({
  id: bookmarkIdSchema,
  chapterId: chapterIdSchema,
  paragraphIndex: z.number().int().min(0).max(READER_BOOKMARK_PARAGRAPH_MAX_INDEX),
  column: z.enum(["raw", "translated"]).nullable(),
  excerpt: z.string(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
// Validate calendar bounds without converting the DB timestamp to a JS Date:
// its original fractional-precision text must round-trip unchanged.
const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
function validCursorTimestamp(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = month === 2 && leapYear ? 29 : (daysInMonth[month - 1] ?? 0);
  return day >= 1 && day <= maxDay && hour <= 23 && minute <= 59 && second <= 59;
}

export const bookmarkCursorV1Schema = z.strictObject({
  ...readerBookmarkCursorSchema.shape,
  createdAt: readerBookmarkCursorSchema.shape.createdAt.refine(
    validCursorTimestamp,
    "Invalid bookmark cursor timestamp",
  ),
});
export const bookmarkPageV1Schema = z.strictObject({
  bookmarks: z.array(bookmarkV1Schema),
  nextCursor: bookmarkCursorV1Schema.nullable(),
});
export const readerStateV1Schema = z.strictObject({
  lastChapterId: chapterIdSchema.nullable(),
  scrollFraction: z.number().min(0).max(1).nullable(),
  readChapterIds: z.array(chapterIdSchema),
  bookmarks: z.array(bookmarkV1Schema),
  bookmarkNextCursor: bookmarkCursorV1Schema.nullable(),
});
export const createBookmarkV1Schema = z.strictObject({
  chapterId: chapterIdSchema,
  paragraphIndex: z.number().int().min(0).max(READER_BOOKMARK_PARAGRAPH_MAX_INDEX),
  column: z.enum(["raw", "translated"]).nullable(),
  excerpt: z.string().min(1).max(READER_BOOKMARK_EXCERPT_MAX_LENGTH),
  note: z.string().max(READER_BOOKMARK_NOTE_MAX_LENGTH).nullable().optional(),
});
export const bookmarkNoteV1Schema = z.strictObject({
  note: z.string().max(READER_BOOKMARK_NOTE_MAX_LENGTH).nullable(),
});
export const positionV1Schema = z.strictObject({ scrollFraction: z.number().min(0).max(1) });
export const successV1Schema = z.strictObject({ success: z.literal(true) });
export const bookmarkCreatedV1Schema = z.strictObject({
  id: bookmarkIdSchema,
  duplicate: z.boolean(),
});
export type ReaderStateV1 = z.infer<typeof readerStateV1Schema>;
export type BookmarkPageV1 = z.infer<typeof bookmarkPageV1Schema>;
export type CreateBookmarkV1 = z.infer<typeof createBookmarkV1Schema>;
