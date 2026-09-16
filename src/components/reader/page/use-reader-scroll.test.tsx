// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { getReaderProgress } from "@/lib/reader/progress";
import { useReaderScroll } from "./use-reader-scroll";

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

function setScrollMetrics(scrollY: number) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: scrollY });
}

describe("useReaderScroll", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
    vi.useFakeTimers();
    storage.clear();
    setScrollMetrics(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn((options?: ScrollToOptions) => {
        Object.defineProperty(window, "scrollY", {
          configurable: true,
          writable: true,
          value: options?.top ?? 0,
        });
      }),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("persists returning from a nonzero position to the top across reload", () => {
    const hook = renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 450 });
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));
    expect(getReaderProgress("novel").scrollFraction).toBe(0.5);

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));
    expect(getReaderProgress("novel").scrollFraction).toBe(0);

    act(() => hook.unmount());
    vi.clearAllMocks();

    renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("flushes the trailing scroll sample when unmounted before the throttle delay", () => {
    const hook = renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 675 });
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(100));
    act(() => hook.unmount());

    expect(getReaderProgress("novel").scrollFraction).toBe(0.75);
  });

  it("restores a saved zero fraction", () => {
    localStorage.setItem(
      "pnt-reader-progress",
      JSON.stringify({
        novel: { lastChapterId: "chapter", readChapterIds: [], scrollFraction: 0 },
      }),
    );

    renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("flushes the throttled scroll sample", () => {
    const hook = renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 450 });
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));

    expect(getReaderProgress("novel").scrollFraction).toBe(0.5);
    act(() => hook.unmount());
  });

  it("cancels the previous chapter restoration before its frame runs", () => {
    localStorage.setItem(
      "pnt-reader-progress",
      JSON.stringify({
        novel: { lastChapterId: "chapter-1", readChapterIds: [], scrollFraction: 0.5 },
      }),
    );

    const hook = renderHook(
      ({ chapterId }: { chapterId: string }) =>
        useReaderScroll("novel", chapterId, { id: chapterId }, true),
      { initialProps: { chapterId: "chapter-1" } },
    );
    hook.rerender({ chapterId: "chapter-2" });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter-2",
      scrollFraction: undefined,
    });
  });

  it("flushes the captured fraction instead of sampling replacement DOM on navigation", () => {
    const hook = renderHook(
      ({ chapterId, settingsReady }: { chapterId: string; settingsReady: boolean }) =>
        useReaderScroll("novel", chapterId, { id: chapterId }, settingsReady),
      { initialProps: { chapterId: "chapter-1", settingsReady: true } },
    );
    act(() => vi.runAllTimers());

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 450 });
    window.dispatchEvent(new Event("scroll"));
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 90 });

    hook.rerender({ chapterId: "chapter-2", settingsReady: false });
    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter-1",
      scrollFraction: 0.5,
    });
    act(() => vi.runAllTimers());
    expect(window.scrollTo).not.toHaveBeenCalled();
    act(() => hook.unmount());
  });

  it("focuses a requested correction anchor before saved progress", () => {
    localStorage.setItem(
      "pnt-reader-progress",
      JSON.stringify({
        novel: { lastChapterId: "chapter", readChapterIds: [], scrollFraction: 0.75 },
      }),
    );
    const target = document.createElement("p");
    target.id = "reader-pair-3";
    target.scrollIntoView = vi.fn();
    document.body.append(target);

    renderHook(() =>
      useReaderScroll("novel", "chapter", { id: "chapter" }, true, "reader-paragraph-3"),
    );
    act(() => vi.runAllTimers());

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "instant",
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
    target.remove();
  });

  it("does not mark a chapter as read just for opening it", () => {
    const hook = renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter",
      readChapterIds: [],
    });
    act(() => hook.unmount());
  });

  it("marks a chapter as read once the reader reaches the end", () => {
    const hook = renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());
    expect(getReaderProgress("novel").readChapterIds).toEqual([]);

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 900 });
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));

    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter",
      readChapterIds: ["chapter"],
    });
    act(() => hook.unmount());
  });

  it("marks unscrollable content as read on open", () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 100,
    });

    renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    expect(getReaderProgress("novel").readChapterIds).toEqual(["chapter"]);
  });

  it("coalesces rapid scroll events into one layout read per frame", () => {
    const hook = renderHook(() => useReaderScroll("novel", "chapter", { id: "chapter" }, true));
    act(() => vi.runAllTimers());

    let reads = 0;
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get() {
        reads += 1;
        return 1000;
      },
    });
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 450 });

    for (let index = 0; index < 5; index += 1) {
      window.dispatchEvent(new Event("scroll"));
    }
    expect(reads).toBe(1);

    act(() => vi.advanceTimersByTime(1));
    window.dispatchEvent(new Event("scroll"));
    expect(reads).toBe(2);
    act(() => hook.unmount());
  });
});
