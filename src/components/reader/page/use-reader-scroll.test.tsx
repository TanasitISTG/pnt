// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { getReaderProgress } from "@/lib/reader/progress";
import type { ReaderProgressStore } from "@/lib/reader/use-reader-state";
import { createLocalReaderStore } from "@/lib/reader/use-reader-state";
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

function renderReaderScroll(options: {
  chapterId: string;
  ready?: boolean;
  targetAnchor?: string | null;
  store?: ReaderProgressStore;
}) {
  const store = options.store ?? createLocalReaderStore("novel");
  const render = (props: { chapterId: string; ready: boolean }) =>
    useReaderScroll({
      novelId: "novel",
      chapterId: props.chapterId,
      chapter: { id: props.chapterId },
      ready: props.ready,
      store,
      targetAnchor: options.targetAnchor ?? null,
    });
  return {
    store,
    ...renderHook(render, {
      initialProps: { chapterId: options.chapterId, ready: options.ready ?? true },
    }),
  };
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
    const hook = renderReaderScroll({ chapterId: "chapter" });
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

    renderReaderScroll({ chapterId: "chapter" });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("flushes the trailing scroll sample when unmounted before the throttle delay", () => {
    const hook = renderReaderScroll({ chapterId: "chapter" });
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

    renderReaderScroll({ chapterId: "chapter" });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("flushes the throttled scroll sample", () => {
    const hook = renderReaderScroll({ chapterId: "chapter" });
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

    const hook = renderReaderScroll({ chapterId: "chapter-1" });
    hook.rerender({ chapterId: "chapter-2", ready: true });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter-2",
      scrollFraction: undefined,
    });
  });

  it("flushes the captured fraction instead of sampling replacement DOM on navigation", () => {
    const hook = renderReaderScroll({ chapterId: "chapter-1" });
    act(() => vi.runAllTimers());

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 450 });
    window.dispatchEvent(new Event("scroll"));
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 90 });

    hook.rerender({ chapterId: "chapter-2", ready: false });
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

    renderReaderScroll({ chapterId: "chapter", targetAnchor: "reader-paragraph-3" });
    act(() => vi.runAllTimers());

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "instant",
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
    target.remove();
  });

  it("does not mark a chapter as read just for opening it", () => {
    const hook = renderReaderScroll({ chapterId: "chapter" });
    act(() => vi.runAllTimers());

    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter",
      readChapterIds: [],
    });
    act(() => hook.unmount());
  });

  it("marks a chapter as read once the reader reaches the end", () => {
    const hook = renderReaderScroll({ chapterId: "chapter" });
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

  it("marks the chapter read even when the reader leaves the end before the flush", () => {
    const hook = renderReaderScroll({ chapterId: "chapter" });
    act(() => vi.runAllTimers());

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 900 });
    window.dispatchEvent(new Event("scroll"));
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 0 });
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));

    expect(getReaderProgress("novel").readChapterIds).toEqual(["chapter"]);
    act(() => hook.unmount());
  });

  it("marks unscrollable content as read on open", () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 100,
    });

    renderReaderScroll({ chapterId: "chapter" });
    act(() => vi.runAllTimers());

    expect(getReaderProgress("novel").readChapterIds).toEqual(["chapter"]);
  });

  it("coalesces rapid scroll events into one layout read per frame", () => {
    const hook = renderReaderScroll({ chapterId: "chapter" });
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

  it("routes every write through the injected store", () => {
    const calls: string[] = [];
    const store = {
      getProgress: () => ({ lastChapterId: "chapter", readChapterIds: [], scrollFraction: 0 }),
      markOpened: (chapterId: string) => calls.push(`opened:${chapterId}`),
      markRead: (chapterId: string) => calls.push(`read:${chapterId}`),
      saveScrollFraction: (fraction: number) => calls.push(`save:${fraction}`),
      flushScrollFraction: (fraction: number) => calls.push(`flush:${fraction}`),
    };

    const hook = renderReaderScroll({ chapterId: "chapter", store });
    act(() => vi.runAllTimers());
    expect(calls).toEqual(["opened:chapter"]);

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 450 });
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));
    expect(calls).toEqual(["opened:chapter", "save:0.5"]);

    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 675 });
    window.dispatchEvent(new Event("scroll"));
    act(() => hook.unmount());

    expect(calls).toEqual(["opened:chapter", "save:0.5", "flush:0.75"]);
  });

  it("survives a caller that rebuilds its store object on every render", () => {
    let opened = 0;
    const createStore = () => ({
      getProgress: () => ({ lastChapterId: "chapter", readChapterIds: [], scrollFraction: 0 }),
      markOpened: () => {
        opened += 1;
      },
      markRead: () => {},
      saveScrollFraction: () => {},
      flushScrollFraction: () => {},
    });

    const { rerender, unmount } = renderHook(() =>
      useReaderScroll({
        novelId: "novel",
        chapterId: "chapter",
        chapter: { id: "chapter" },
        ready: true,
        store: createStore(),
      }),
    );
    act(() => vi.runAllTimers());

    rerender();
    rerender();
    act(() => vi.runAllTimers());

    expect(opened).toBe(1);
    act(() => unmount());
  });
});
