// Shared types for reader preferences & progress. Leaf module — types only.

export type ReaderFontSize = "S" | "M" | "L" | "XL";
export type ReaderTypeface = "default" | "reader";
export type ReaderViewMode = "side" | "translated" | "raw";

export interface ReaderSettings {
  fontSize: ReaderFontSize;
  typeface: ReaderTypeface;
  viewMode: ReaderViewMode;
}

export interface ReaderProgress {
  lastChapterId: string | null;
  readChapterIds: string[];
  scrollFraction?: number;
}
