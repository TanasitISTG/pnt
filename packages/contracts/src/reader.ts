// Shared types for reader preferences, progress and bookmarks. Leaf module — types only.

export type ReaderFontSize = "S" | "M" | "L" | "XL";
export type ReaderTypeface = "default" | "reader";
export type ReaderViewMode = "side" | "translated" | "raw";
export type ReaderLineHeight = "compact" | "normal" | "relaxed";
export type ReaderMeasure = "narrow" | "medium" | "wide";
export type ReaderPageTheme = "app" | "sepia" | "paper";
export type ReaderColumn = "raw" | "translated";

export interface ReaderSettings {
  fontSize: ReaderFontSize;
  typeface: ReaderTypeface;
  viewMode: ReaderViewMode;
  lineHeight: ReaderLineHeight;
  measure: ReaderMeasure;
  pageTheme: ReaderPageTheme;
}

export interface ReaderProgress {
  lastChapterId: string | null;
  readChapterIds: string[];
  scrollFraction?: number;
}

export interface ReaderBookmark {
  id: string;
  chapterId: string;
  paragraphIndex: number;
  column: ReaderColumn | null;
  excerpt: string;
  note: string | null;
  createdAt: string;
}

export interface ReaderBookmarkInput {
  chapterId: string;
  paragraphIndex: number;
  column: ReaderColumn | null;
  excerpt: string;
  note?: string | null;
}

// Keyset continuation for the global bookmark list. `createdAt` is the database's own
// timestamp text, so it round-trips fractional precision without a JS Date conversion.
export interface ReaderBookmarkCursor {
  createdAt: string;
  id: string;
}

export interface ReaderBookmarkPage {
  bookmarks: ReaderBookmark[];
  nextCursor: ReaderBookmarkCursor | null;
}

export interface ReaderNovelState {
  lastChapterId: string | null;
  scrollFraction: number | null;
  readChapterIds: string[];
  bookmarks: ReaderBookmark[];
  bookmarkNextCursor: ReaderBookmarkCursor | null;
}
