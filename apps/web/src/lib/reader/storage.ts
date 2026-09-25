export const READER_PROGRESS_STORAGE_KEY = "pnt-reader-progress";
export const READER_BOOKMARKS_STORAGE_KEY = "pnt-reader-bookmarks";

export function getReaderStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // Return null if storage is disabled or restricted
  }
  return null;
}
