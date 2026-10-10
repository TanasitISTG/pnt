// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  addReaderBookmark,
  listReaderBookmarks,
  removeReaderBookmark,
  updateReaderBookmarkNote,
} from "./bookmarks";
import { READER_BOOKMARKS_STORAGE_KEY } from "./storage";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

describe("reader bookmarks (guest store)", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  });

  it("keeps bookmarks per novel and returns the newest first", () => {
    addReaderBookmark("novel-a", {
      chapterId: "chapter-1",
      paragraphIndex: 3,
      column: null,
      excerpt: "first",
    });
    addReaderBookmark("novel-a", {
      chapterId: "chapter-2",
      paragraphIndex: 7,
      column: "translated",
      excerpt: "second",
      note: "remember this",
    });
    addReaderBookmark("novel-b", {
      chapterId: "chapter-9",
      paragraphIndex: 0,
      column: null,
      excerpt: "other novel",
    });

    const bookmarks = listReaderBookmarks("novel-a");
    expect(bookmarks.map((bookmark) => bookmark.excerpt)).toEqual(["second", "first"]);
    expect(bookmarks[0]).toMatchObject({
      chapterId: "chapter-2",
      paragraphIndex: 7,
      column: "translated",
      note: "remember this",
    });
    expect(bookmarks[0].id).toBeTruthy();
    expect(listReaderBookmarks("novel-b")).toHaveLength(1);
  });

  it("returns no bookmarks for a novel without stored data", () => {
    expect(listReaderBookmarks("missing")).toEqual([]);
    expect(listReaderBookmarks("missing")).toBe(listReaderBookmarks("missing"));
  });

  it("ignores malformed stored payloads instead of throwing", () => {
    localStorage.setItem(READER_BOOKMARKS_STORAGE_KEY, "{not json");
    expect(listReaderBookmarks("novel-a")).toEqual([]);

    localStorage.setItem(
      READER_BOOKMARKS_STORAGE_KEY,
      JSON.stringify({ "novel-a": [{ id: 5 }, null, "nope"], "novel-b": "wrong" }),
    );
    expect(listReaderBookmarks("novel-a")).toEqual([]);
    expect(listReaderBookmarks("novel-b")).toEqual([]);
  });

  it("replaces top-level array storage on the next mutation", () => {
    localStorage.setItem(
      READER_BOOKMARKS_STORAGE_KEY,
      JSON.stringify([
        [
          {
            id: "corrupt",
            chapterId: "chapter-corrupt",
            paragraphIndex: 0,
            column: null,
            excerpt: "corrupt",
            note: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      ]),
    );
    expect(listReaderBookmarks("0")).toEqual([]);

    localStorage.setItem(READER_BOOKMARKS_STORAGE_KEY, "[]");
    const created = addReaderBookmark("novel-a", {
      chapterId: "chapter-1",
      paragraphIndex: 3,
      column: null,
      excerpt: "first",
    });

    const stored = JSON.parse(localStorage.getItem(READER_BOOKMARKS_STORAGE_KEY) ?? "null");
    expect(Array.isArray(stored)).toBe(false);
    expect(stored).toEqual({ "novel-a": [created] });
  });

  it("does not duplicate a bookmark for the same paragraph and column", () => {
    const first = addReaderBookmark("novel-a", {
      chapterId: "chapter-1",
      paragraphIndex: 3,
      column: null,
      excerpt: "first",
    });
    const duplicate = addReaderBookmark("novel-a", {
      chapterId: "chapter-1",
      paragraphIndex: 3,
      column: null,
      excerpt: "different text, same position",
    });

    expect(listReaderBookmarks("novel-a")).toHaveLength(1);
    expect(duplicate?.id).toBe(first?.id);
  });

  it("treats the same paragraph in the other column as a separate bookmark", () => {
    addReaderBookmark("novel-a", {
      chapterId: "chapter-1",
      paragraphIndex: 3,
      column: "raw",
      excerpt: "source",
    });
    addReaderBookmark("novel-a", {
      chapterId: "chapter-1",
      paragraphIndex: 3,
      column: "translated",
      excerpt: "translation",
    });

    expect(listReaderBookmarks("novel-a")).toHaveLength(2);
  });

  it("updates a note and removes a bookmark by id", () => {
    const created = addReaderBookmark("novel-a", {
      chapterId: "chapter-1",
      paragraphIndex: 3,
      column: null,
      excerpt: "first",
    });
    if (!created) throw new Error("expected a bookmark");

    updateReaderBookmarkNote("novel-a", created.id, "note text");
    expect(listReaderBookmarks("novel-a")[0].note).toBe("note text");

    updateReaderBookmarkNote("novel-a", created.id, null);
    expect(listReaderBookmarks("novel-a")[0].note).toBeNull();

    removeReaderBookmark("novel-a", created.id);
    expect(listReaderBookmarks("novel-a")).toEqual([]);
  });
});
