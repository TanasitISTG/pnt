// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { createRef, useCallback, useRef, useState } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { getReaderProgress } from "@/lib/reader/progress";
import { readerStateQueryKey } from "@/lib/reader/query";
import type { ReaderNovelState } from "@/lib/reader/types";
import type { AccountReaderPersistence, ReaderProgressStore } from "@/lib/reader/use-reader-state";
import { createAccountReaderStore, createLocalReaderStore } from "@/lib/reader/use-reader-state";
import { useReaderScroll } from "./use-reader-scroll";
import { ReaderProse } from "../content/reader-content-prose";
import { ReaderChapterProgress } from "../controls/reader-chapter-progress";

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

// Viewport 1000 tall, prose spanning 200..3200 with a pinned toolbar covering 80px:
// readable range 120..2200, so the app footer below 2200 cannot move the fraction.
const VIEWPORT_HEIGHT = 1000;
const TOOLBAR_HEIGHT = 80;
const RANGE_START = 120;
const RANGE_END = 2200;
const RANGE_SPAN = RANGE_END - RANGE_START;

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value });
}

function scrollToFraction(fraction: number) {
  setScrollY(RANGE_START + fraction * RANGE_SPAN);
}

function rectFor(top: number, bottom: number): DOMRect {
  const height = bottom - top;
  return {
    top,
    bottom,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function createProse({
  top = 200,
  bottom = 3200,
  onMeasure,
}: {
  top?: number;
  bottom?: number;
  onMeasure?: () => void;
} = {}) {
  const prose = document.createElement("div");
  prose.getBoundingClientRect = () => {
    onMeasure?.();
    // The helper adds window.scrollY back, so a document-relative rect is what a real
    // browser would report for this scroll offset.
    return rectFor(top - window.scrollY, bottom - window.scrollY);
  };
  document.body.append(prose);
  return prose;
}

function createToolbar({ pinnedTop = "0px" }: { pinnedTop?: string } = {}) {
  const toolbar = document.createElement("header");
  toolbar.style.position = "sticky";
  toolbar.style.top = pinnedTop;
  toolbar.getBoundingClientRect = () => rectFor(0, TOOLBAR_HEIGHT);
  document.body.append(toolbar);
  return toolbar;
}

function renderReaderScroll(options: {
  chapterId: string;
  ready?: boolean;
  targetAnchor?: string | null;
  store?: ReaderProgressStore;
  prose?: HTMLDivElement | null;
  toolbar?: HTMLElement | null;
}) {
  const store = options.store ?? createLocalReaderStore("novel");
  const proseRef = createRef<HTMLDivElement>();
  const toolbarRef = createRef<HTMLElement>();
  proseRef.current = options.prose ?? null;
  toolbarRef.current = options.toolbar ?? null;
  const render = (props: { chapterId: string; ready: boolean }) =>
    useReaderScroll({
      novelId: "novel",
      chapterId: props.chapterId,
      chapter: { id: props.chapterId },
      ready: props.ready,
      store,
      targetAnchor: options.targetAnchor ?? null,
      proseRef,
      toolbarRef,
      layoutKey: props.chapterId,
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
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: VIEWPORT_HEIGHT,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 4000,
    });
    setScrollY(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn((options?: ScrollToOptions) => {
        setScrollY(options?.top ?? 0);
      }),
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("persists returning from a nonzero position to the top across reload", () => {
    const toolbar = createToolbar();
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse(),
      toolbar,
    });
    act(() => vi.runAllTimers());

    scrollToFraction(0.5);
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));
    expect(getReaderProgress("novel").scrollFraction).toBe(0.5);

    setScrollY(RANGE_START);
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));
    expect(getReaderProgress("novel").scrollFraction).toBe(0);

    act(() => hook.unmount());
    vi.clearAllMocks();

    renderReaderScroll({ chapterId: "chapter", prose: createProse(), toolbar });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).toHaveBeenCalledWith({ top: RANGE_START, behavior: "instant" });
  });

  it("flushes the trailing scroll sample when unmounted before the throttle delay", () => {
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    scrollToFraction(0.75);
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

    renderReaderScroll({ chapterId: "chapter", prose: createProse(), toolbar: createToolbar() });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).toHaveBeenCalledWith({ top: RANGE_START, behavior: "instant" });
  });

  it("restores a saved fraction against the prose bounds", () => {
    localStorage.setItem(
      "pnt-reader-progress",
      JSON.stringify({
        novel: { lastChapterId: "chapter", readChapterIds: [], scrollFraction: 0.5 },
      }),
    );

    renderReaderScroll({ chapterId: "chapter", prose: createProse(), toolbar: createToolbar() });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 1160, behavior: "instant" });
  });

  it("flushes the throttled scroll sample", () => {
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    scrollToFraction(0.5);
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

    const hook = renderReaderScroll({
      chapterId: "chapter-1",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    hook.rerender({ chapterId: "chapter-2", ready: true });
    act(() => vi.runAllTimers());

    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter-2",
      scrollFraction: undefined,
    });
  });

  it("flushes the captured fraction instead of sampling replacement DOM on navigation", () => {
    const hook = renderReaderScroll({
      chapterId: "chapter-1",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    scrollToFraction(0.5);
    window.dispatchEvent(new Event("scroll"));
    setScrollY(90);

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

    renderReaderScroll({
      chapterId: "chapter",
      targetAnchor: "reader-paragraph-3",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      block: "start",
      behavior: "instant",
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("does not mark a chapter as read just for opening it", () => {
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter",
      readChapterIds: [],
    });
    act(() => hook.unmount());
  });

  it("marks a chapter as read once the reader reaches the end", () => {
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());
    expect(getReaderProgress("novel").readChapterIds).toEqual([]);

    setScrollY(RANGE_END);
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));

    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter",
      readChapterIds: ["chapter"],
    });
    act(() => hook.unmount());
  });

  it("marks the chapter read even when the reader leaves the end before the flush", () => {
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    setScrollY(RANGE_END);
    window.dispatchEvent(new Event("scroll"));
    setScrollY(RANGE_START);
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));

    expect(getReaderProgress("novel").readChapterIds).toEqual(["chapter"]);
    act(() => hook.unmount());
  });

  it("marks prose that fits above the fold as read even when the footer scrolls", () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 6000,
    });

    renderReaderScroll({
      chapterId: "chapter",
      prose: createProse({ top: 200, bottom: 700 }),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    expect(getReaderProgress("novel").readChapterIds).toEqual(["chapter"]);
  });

  it("does not mark a chapter read while the prose node is absent", () => {
    renderReaderScroll({ chapterId: "chapter", prose: null, toolbar: createToolbar() });
    act(() => vi.runAllTimers());

    expect(getReaderProgress("novel")).toMatchObject({
      lastChapterId: "chapter",
      readChapterIds: [],
      scrollFraction: undefined,
    });
  });

  it("reattaches fit and progress observers after the editor replaces the prose node", () => {
    const observers = new Set<{ targets: Set<Element>; notify: () => void }>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets = new Set<Element>();
        notify: () => void;
        constructor(notify: () => void) {
          this.notify = notify;
          observers.add(this);
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        disconnect() {
          this.targets.clear();
          observers.delete(this);
        }
      },
    );
    let bottom = 3200;
    const store = createLocalReaderStore("novel");
    const toolbarRef = createRef<HTMLElement>();
    toolbarRef.current = createToolbar();
    function Harness({ editing }: { editing: boolean }) {
      const proseRef = useRef<HTMLDivElement | null>(null);
      const [proseNode, setProseNode] = useState<HTMLDivElement | null>(null);
      const attach = useCallback((node: HTMLDivElement | null) => {
        if (node)
          node.getBoundingClientRect = () => rectFor(200 - window.scrollY, bottom - window.scrollY);
        proseRef.current = node;
        setProseNode(node);
      }, []);
      useReaderScroll({
        novelId: "novel",
        chapterId: "chapter",
        chapter: { id: "chapter" },
        ready: true,
        store,
        proseRef,
        proseNode,
        toolbarRef,
        layoutKey: "unchanged",
      });
      return (
        <>
          <ReaderChapterProgress
            proseRef={proseRef}
            proseNode={proseNode}
            toolbarRef={toolbarRef}
            layoutKey="unchanged"
          />
          {editing ? (
            <textarea aria-label="Chapter editor" />
          ) : (
            <ReaderProse
              paragraphs={["Chapter prose"]}
              fontSizePx={18}
              lineHeight={1.8}
              measureRem={40}
              lang="en"
              proseRef={attach}
            />
          )}
        </>
      );
    }
    const view = render(<Harness editing={false} />);
    act(() => vi.runAllTimers());
    const original = screen.getByText("Chapter prose").parentElement!;
    expect(screen.getByRole("progressbar")).toBeTruthy();
    view.rerender(<Harness editing />);
    act(() => vi.runAllTimers());
    expect(original.isConnected).toBe(false);
    expect(getReaderProgress("novel").readChapterIds).toEqual([]);
    expect(screen.queryByRole("progressbar")).toBeNull();
    view.rerender(<Harness editing={false} />);
    act(() => vi.runAllTimers());
    const replacement = screen.getByText("Chapter prose").parentElement!;
    expect(replacement).not.toBe(original);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    // Only observers attached to the replacement receive its resize. No window event
    // or layout-key change can accidentally rescue an observer stranded on the old node.
    bottom = 800;
    act(() => {
      for (const observer of observers) {
        if (observer.targets.has(replacement)) observer.notify();
        expect(observer.targets.has(original)).toBe(false);
      }
      vi.runAllTimers();
    });
    expect(getReaderProgress("novel").readChapterIds).toEqual(["chapter"]);
    expect(screen.queryByRole("progressbar")).toBeNull();
    view.unmount();
    expect(observers.size).toBe(0);
  });

  it("resamples fitting prose on viewport-height-only resize and removes the listener", () => {
    const store = createLocalReaderStore("novel");
    const markRead = vi.spyOn(store, "markRead");
    const onMeasure = vi.fn();
    const hook = renderReaderScroll({
      chapterId: "chapter",
      store,
      prose: createProse({ bottom: 1600, onMeasure }),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());
    expect(markRead).not.toHaveBeenCalled();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1800 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(getReaderProgress("novel").readChapterIds).toEqual(["chapter"]);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(markRead).toHaveBeenCalledTimes(1);
    hook.unmount();
    onMeasure.mockClear();
    act(() => window.dispatchEvent(new Event("resize")));
    expect(onMeasure).not.toHaveBeenCalled();
  });

  it("keeps the footer out of the saved fraction", () => {
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse(),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());

    setScrollY(RANGE_END);
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));
    expect(getReaderProgress("novel").scrollFraction).toBe(1);

    // Scrolling on into the app footer cannot push the fraction past the prose end.
    setScrollY(RANGE_END + 800);
    window.dispatchEvent(new Event("scroll"));
    act(() => vi.advanceTimersByTime(300));
    expect(getReaderProgress("novel").scrollFraction).toBe(1);
    act(() => hook.unmount());
  });

  it("coalesces rapid scroll events into one layout read per frame", () => {
    let reads = 0;
    const hook = renderReaderScroll({
      chapterId: "chapter",
      prose: createProse({ onMeasure: () => (reads += 1) }),
      toolbar: createToolbar(),
    });
    act(() => vi.runAllTimers());
    reads = 0;

    for (let index = 0; index < 5; index += 1) {
      window.dispatchEvent(new Event("scroll"));
    }
    expect(reads).toBe(1);

    act(() => vi.advanceTimersByTime(1));
    window.dispatchEvent(new Event("scroll"));
    expect(reads).toBe(2);
    act(() => hook.unmount());
  });

  it.each(["pagehide", "hidden visibilitychange"])(
    "persists and restores the latest account fraction on %s before the capture timer",
    async (lifecycle) => {
      vi.setSystemTime(0);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: false } },
      });
      queryClient.setQueryData<ReaderNovelState>(readerStateQueryKey("novel"), {
        lastChapterId: "chapter",
        scrollFraction: 0.2,
        readChapterIds: [],
        bookmarks: [],
        bookmarkNextCursor: null,
      });
      let durableFraction = 0.2;
      const savePosition = vi.fn(
        async (
          input: Parameters<AccountReaderPersistence["savePosition"]>[0],
          _options?: { keepalive?: boolean },
        ) => {
          durableFraction = input.scrollFraction;
          return {};
        },
      );
      const persist = { setChapter: vi.fn(async () => ({})), savePosition };
      const store = createAccountReaderStore({ novelId: "novel", queryClient, persist });
      const toolbar = createToolbar();
      const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

      try {
        const hook = renderReaderScroll({
          chapterId: "chapter",
          store,
          prose: createProse(),
          toolbar,
        });
        // The fake animation frames settle restoration before scroll capture starts.
        await act(async () => vi.advanceTimersByTimeAsync(10));
        scrollToFraction(0.6);
        window.dispatchEvent(new Event("scroll"));
        await act(async () => vi.advanceTimersByTimeAsync(300));
        expect(durableFraction).toBe(0.6);
        expect(savePosition).toHaveBeenCalledTimes(1);

        // The second event shares the frame gate: lifecycle capture must read the
        // current geometry, not just reuse the earlier pending 0.605 sample.
        scrollToFraction(0.605);
        window.dispatchEvent(new Event("scroll"));
        scrollToFraction(0.61);
        window.dispatchEvent(new Event("scroll"));
        await act(async () => vi.advanceTimersByTimeAsync(100));
        document.dispatchEvent(new Event("visibilitychange"));
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(durableFraction).toBe(0.6);
        expect(savePosition).toHaveBeenCalledTimes(1);

        if (lifecycle === "pagehide") {
          window.dispatchEvent(new Event("pagehide"));
        } else {
          visibility.mockReturnValue("hidden");
          document.dispatchEvent(new Event("visibilitychange"));
        }
        // Drain the persistence queue without reaching the 300ms capture deadline
        // or the account store's four-second trailing-save deadline.
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(durableFraction).toBe(0.61);
        expect(savePosition).toHaveBeenLastCalledWith(
          { novelId: "novel", chapterId: "chapter", scrollFraction: 0.61 },
          { keepalive: true },
        );
        hook.unmount();

        const reopenedStore = createAccountReaderStore({ novelId: "novel", queryClient, persist });
        setScrollY(0);
        vi.mocked(window.scrollTo).mockClear();
        const reopened = renderReaderScroll({
          chapterId: "chapter",
          store: reopenedStore,
          prose: createProse(),
          toolbar,
        });
        await act(async () => vi.advanceTimersByTimeAsync(10));
        expect(window.scrollTo).toHaveBeenCalledWith({
          top: RANGE_START + 0.61 * RANGE_SPAN,
          behavior: "instant",
        });
        expect(reopenedStore.getProgress().readChapterIds).toEqual([]);
        reopened.unmount();
      } finally {
        visibility.mockRestore();
        queryClient.clear();
      }
    },
  );

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
    const proseRef = createRef<HTMLDivElement>();
    const toolbarRef = createRef<HTMLElement>();
    proseRef.current = createProse();
    toolbarRef.current = createToolbar();

    const { rerender, unmount } = renderHook(() =>
      useReaderScroll({
        novelId: "novel",
        chapterId: "chapter",
        chapter: { id: "chapter" },
        ready: true,
        store: createStore(),
        proseRef,
        toolbarRef,
        layoutKey: "chapter",
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
