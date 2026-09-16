import type { ReaderBookmark, ReaderBookmarkInput } from "./types";
import { getReaderStorage, READER_BOOKMARKS_STORAGE_KEY as STORAGE_KEY } from "./storage";
import { nanoid } from "@/lib/utils";

const EMPTY_BOOKMARKS: ReaderBookmark[] = [];

function isReaderBookmark(value: unknown): value is ReaderBookmark {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.chapterId === "string" &&
    typeof record.paragraphIndex === "number" &&
    Number.isFinite(record.paragraphIndex) &&
    typeof record.excerpt === "string" &&
    typeof record.createdAt === "string" &&
    (record.note === null || typeof record.note === "string") &&
    (record.column === null || record.column === "raw" || record.column === "translated")
  );
}

function readAll(): Record<string, unknown> {
  const storage = getReaderStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, unknown>): void {
  const storage = getReaderStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage write errors
  }
}

export function listReaderBookmarks(novelId: string): ReaderBookmark[] {
  const stored = readAll()[novelId];
  if (!Array.isArray(stored)) return EMPTY_BOOKMARKS;
  const bookmarks = stored.filter(isReaderBookmark);
  return bookmarks.length > 0 ? bookmarks : EMPTY_BOOKMARKS;
}

function writeNovelBookmarks(novelId: string, bookmarks: ReaderBookmark[]): void {
  const all = readAll();
  all[novelId] = bookmarks;
  writeAll(all);
}

export function addReaderBookmark(
  novelId: string,
  input: ReaderBookmarkInput,
): ReaderBookmark | null {
  const storage = getReaderStorage();
  if (!storage) return null;

  const existing = listReaderBookmarks(novelId);
  const duplicate = existing.find(
    (bookmark) =>
      bookmark.chapterId === input.chapterId &&
      bookmark.paragraphIndex === input.paragraphIndex &&
      bookmark.column === input.column,
  );
  if (duplicate) return duplicate;

  const bookmark: ReaderBookmark = {
    id: nanoid(),
    chapterId: input.chapterId,
    paragraphIndex: input.paragraphIndex,
    column: input.column,
    excerpt: input.excerpt,
    note: input.note ?? null,
    createdAt: new Date().toISOString(),
  };

  writeNovelBookmarks(novelId, [bookmark, ...existing]);
  return bookmark;
}

export function removeReaderBookmark(novelId: string, bookmarkId: string): void {
  const existing = listReaderBookmarks(novelId);
  const remaining = existing.filter((bookmark) => bookmark.id !== bookmarkId);
  if (remaining.length === existing.length) return;
  writeNovelBookmarks(novelId, remaining);
}

export function updateReaderBookmarkNote(
  novelId: string,
  bookmarkId: string,
  note: string | null,
): void {
  const existing = listReaderBookmarks(novelId);
  const next = existing.map((bookmark) =>
    bookmark.id === bookmarkId ? { ...bookmark, note } : bookmark,
  );
  writeNovelBookmarks(novelId, next);
}
