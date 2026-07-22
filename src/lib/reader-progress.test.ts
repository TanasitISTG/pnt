import { beforeEach, describe, expect, it } from "vitest";

import { getReaderProgress, markChapterRead } from "./reader-progress";

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

describe("reader-progress", () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", {
        value: globalThis.localStorage,
        writable: true,
        configurable: true,
      });
    }
  });

  it("returns empty progress when storage is empty", () => {
    const progress = getReaderProgress("novel-1");
    expect(progress).toEqual({
      lastChapterId: null,
      readChapterIds: [],
    });
  });

  it("marks a chapter as read and sets lastChapterId", () => {
    const updated = markChapterRead("novel-1", "chap-1");
    expect(updated).toEqual({
      lastChapterId: "chap-1",
      readChapterIds: ["chap-1"],
    });

    const read = getReaderProgress("novel-1");
    expect(read).toEqual({
      lastChapterId: "chap-1",
      readChapterIds: ["chap-1"],
    });
  });

  it("preserves previous reads when marking additional chapters read", () => {
    markChapterRead("novel-1", "chap-1");
    const updated = markChapterRead("novel-1", "chap-2");

    expect(updated).toEqual({
      lastChapterId: "chap-2",
      readChapterIds: ["chap-1", "chap-2"],
    });

    const read = getReaderProgress("novel-1");
    expect(read.readChapterIds).toEqual(["chap-1", "chap-2"]);
    expect(read.lastChapterId).toBe("chap-2");
  });

  it("does not duplicate read chapter IDs if marked twice", () => {
    markChapterRead("novel-1", "chap-1");
    const updated = markChapterRead("novel-1", "chap-1");

    expect(updated).toEqual({
      lastChapterId: "chap-1",
      readChapterIds: ["chap-1"],
    });
  });

  it("isolates progress per novel", () => {
    markChapterRead("novel-1", "chap-10");
    markChapterRead("novel-2", "chap-20");

    expect(getReaderProgress("novel-1")).toEqual({
      lastChapterId: "chap-10",
      readChapterIds: ["chap-10"],
    });

    expect(getReaderProgress("novel-2")).toEqual({
      lastChapterId: "chap-20",
      readChapterIds: ["chap-20"],
    });
  });

  it("handles malformed JSON in storage gracefully", () => {
    localStorage.setItem("pnt-reader-progress", "{ malformed json ");
    expect(getReaderProgress("novel-1")).toEqual({
      lastChapterId: null,
      readChapterIds: [],
    });

    // Should overwrite malformed storage safely when marking read
    const updated = markChapterRead("novel-1", "chap-1");
    expect(updated).toEqual({
      lastChapterId: "chap-1",
      readChapterIds: ["chap-1"],
    });
  });

  it("handles invalid storage structures gracefully", () => {
    localStorage.setItem("pnt-reader-progress", JSON.stringify({ "novel-1": "not-an-object" }));
    expect(getReaderProgress("novel-1")).toEqual({
      lastChapterId: null,
      readChapterIds: [],
    });
  });
});
