// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readerStateQueryKey } from "./query";
import type * as ReaderQuery from "./query";
import type { ReaderBookmarkPage, ReaderNovelState } from "./types";
import {
  createAccountReaderStore,
  createLocalReaderStore,
  useReaderState,
} from "./use-reader-state";
import { getReaderProgress } from "./progress";

// Continuation pages resolve from this registry so the paging hook can be driven without a
// server: the key is the cursor id the hook is continuing from.
const bookmarkPages = vi.hoisted(() => new Map<string, () => Promise<ReaderBookmarkPage>>());

vi.mock("./query", async (importOriginal) => {
  const actual = await importOriginal<typeof ReaderQuery>();
  return {
    ...actual,
    readerBookmarkPageQueryOptions: (novelId: string, cursor: { createdAt: string; id: string }) =>
      queryOptions({
        queryKey: [...actual.readerBookmarkPagesQueryKey(novelId), cursor.createdAt, cursor.id],
        queryFn: async (): Promise<ReaderBookmarkPage> => {
          const load = bookmarkPages.get(cursor.id);
          if (!load) throw new Error(`unexpected bookmark cursor ${cursor.id}`);
          return load();
        },
        staleTime: 0,
      }),
  };
});

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

const SERVER_STATE: ReaderNovelState = {
  lastChapterId: "chapter-1",
  scrollFraction: 0.4,
  readChapterIds: ["chapter-1"],
  bookmarks: [],
  bookmarkNextCursor: null,
};

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setupAccountStore(
  persist: Parameters<typeof createAccountReaderStore>[0]["persist"] = {},
) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(readerStateQueryKey("novel"), SERVER_STATE);
  const store = createAccountReaderStore({ novelId: "novel", queryClient, persist });
  return { queryClient, store };
}

function cachedState(queryClient: QueryClient): ReaderNovelState {
  return queryClient.getQueryData(readerStateQueryKey("novel")) ?? SERVER_STATE;
}

beforeEach(() => {
  const storage = new MemoryStorage();
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createLocalReaderStore", () => {
  it("reads and writes guest progress in localStorage", () => {
    const store = createLocalReaderStore("novel");

    expect(store.getProgress()).toEqual({ lastChapterId: null, readChapterIds: [] });

    store.markOpened("chapter-1");
    expect(getReaderProgress("novel").lastChapterId).toBe("chapter-1");

    store.saveScrollFraction(0.25);
    expect(getReaderProgress("novel").scrollFraction).toBe(0.25);

    store.markRead("chapter-1");
    expect(store.getProgress().readChapterIds).toEqual(["chapter-1"]);
  });

  it("keeps scroll samples out of the react snapshot but notifies on chapter state", () => {
    const store = createLocalReaderStore("novel");
    const listener = vi.fn();
    store.subscribe(listener);

    store.saveScrollFraction(0.5);
    expect(listener).not.toHaveBeenCalled();

    store.markOpened("chapter-1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().lastChapterId).toBe("chapter-1");
  });

  it("stores guest bookmarks and exposes them through the snapshot", () => {
    const store = createLocalReaderStore("novel");
    const input = {
      chapterId: "chapter-1",
      paragraphIndex: 2,
      column: null,
      excerpt: "excerpt",
      note: "note",
    };

    expect(store.addBookmark(input)).toBe(true);
    expect(store.addBookmark(input)).toBe(false);

    expect(store.getSnapshot().bookmarks).toHaveLength(1);
    const bookmarkId = store.getSnapshot().bookmarks[0].id;

    store.updateBookmarkNote(bookmarkId, "updated");
    expect(store.getSnapshot().bookmarks[0].note).toBe("updated");

    store.removeBookmark(bookmarkId);
    expect(store.getSnapshot().bookmarks).toHaveLength(0);
  });
});

describe("createAccountReaderStore", () => {
  it("reads progress from the cached server state", () => {
    const { store } = setupAccountStore();

    expect(store.getProgress()).toEqual({
      lastChapterId: "chapter-1",
      readChapterIds: ["chapter-1"],
      scrollFraction: 0.4,
    });
  });

  it("marks a chapter opened optimistically and persists it", async () => {
    const setChapter = vi.fn(async () => ({}));
    const { queryClient, store } = setupAccountStore({ setChapter });

    store.markOpened("chapter-2");
    expect(cachedState(queryClient).lastChapterId).toBe("chapter-2");
    expect(store.getProgress().scrollFraction).toBeUndefined();

    await flushPromises();
    expect(setChapter).toHaveBeenCalledWith({ novelId: "novel", chapterId: "chapter-2" });
  });

  it("keeps the local scroll fraction available for the same chapter only", () => {
    const { store } = setupAccountStore({ savePosition: async () => ({}) });

    store.markOpened("chapter-1");
    store.saveScrollFraction(0.75);
    expect(store.getProgress().scrollFraction).toBe(0.75);

    store.markOpened("chapter-2");
    expect(store.getProgress().scrollFraction).toBeUndefined();
  });

  it("flushes the first scroll sample immediately and throttles the rest", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const savePosition = vi.fn(async () => ({}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey("novel"), SERVER_STATE);
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { savePosition },
      now: () => clock,
    });

    store.markOpened("chapter-1");
    await vi.runOnlyPendingTimersAsync();

    store.saveScrollFraction(0.5);
    await vi.runOnlyPendingTimersAsync();
    expect(savePosition).toHaveBeenCalledTimes(1);
    expect(savePosition).toHaveBeenLastCalledWith({
      novelId: "novel",
      chapterId: "chapter-1",
      scrollFraction: 0.5,
    });

    clock = 1_000;
    store.saveScrollFraction(0.6);
    expect(savePosition).toHaveBeenCalledTimes(1);

    clock = 5_000;
    await vi.runOnlyPendingTimersAsync();
    expect(savePosition).toHaveBeenCalledTimes(2);
    expect(savePosition).toHaveBeenLastCalledWith({
      novelId: "novel",
      chapterId: "chapter-1",
      scrollFraction: 0.6,
    });
  });

  it("ignores scroll samples that barely moved inside the flush window", async () => {
    let clock = 0;
    const savePosition = vi.fn(async () => ({}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey("novel"), SERVER_STATE);
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { savePosition },
      now: () => clock,
    });

    store.markOpened("chapter-1");
    await flushPromises();
    savePosition.mockClear();

    store.saveScrollFraction(0.5);
    await flushPromises();
    expect(savePosition).toHaveBeenCalledTimes(1);

    clock = 500;
    store.saveScrollFraction(0.505);
    await flushPromises();
    expect(savePosition).toHaveBeenCalledTimes(1);

    clock = 4_500;
    store.saveScrollFraction(0.51);
    await flushPromises();
    expect(savePosition).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a sample the periodic flush already sent", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const savePosition = vi.fn(async () => ({}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey("novel"), SERVER_STATE);
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { savePosition },
      now: () => clock,
    });

    store.markOpened("chapter-1");
    await vi.runOnlyPendingTimersAsync();
    savePosition.mockClear();

    store.saveScrollFraction(0.5);
    await vi.runOnlyPendingTimersAsync();
    expect(savePosition).toHaveBeenCalledTimes(1);

    clock = 1_000;
    store.saveScrollFraction(0.6);
    clock = 5_000;
    store.saveScrollFraction(0.65);
    await vi.runOnlyPendingTimersAsync();

    expect(savePosition).toHaveBeenCalledTimes(2);
    expect(savePosition).toHaveBeenLastCalledWith({
      novelId: "novel",
      chapterId: "chapter-1",
      scrollFraction: 0.65,
    });
  });

  it("always persists an explicit flush", async () => {
    const savePosition = vi.fn(async () => ({}));
    const { store } = setupAccountStore({ savePosition });

    store.markOpened("chapter-1");
    await flushPromises();
    store.saveScrollFraction(0.5);
    await flushPromises();
    savePosition.mockClear();

    store.flushScrollFraction(0.55);
    await flushPromises();

    expect(savePosition).toHaveBeenCalledWith({
      novelId: "novel",
      chapterId: "chapter-1",
      scrollFraction: 0.55,
    });
  });

  it("skips the write that an unloading page could never deliver", async () => {
    const savePosition = vi.fn(async () => ({}));
    const { store } = setupAccountStore({ savePosition });

    store.markOpened("chapter-1");
    await flushPromises();
    savePosition.mockClear();

    store.flushScrollFraction(0.55, { unload: true });
    await flushPromises();
    expect(savePosition).not.toHaveBeenCalled();

    store.flushScrollFraction(0.6);
    await flushPromises();
    expect(savePosition).toHaveBeenCalledWith({
      novelId: "novel",
      chapterId: "chapter-1",
      scrollFraction: 0.6,
    });
  });

  it("serializes writes so a chapter change cannot be overwritten by a late sample", async () => {
    const order: string[] = [];
    const { store } = setupAccountStore({
      setChapter: async () => {
        order.push("open:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("open:end");
      },
      savePosition: async () => {
        order.push("save");
      },
    });

    store.markOpened("chapter-1");
    store.saveScrollFraction(0.5);
    await flushPromises();
    expect(order).toEqual(["open:start"]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["open:start", "open:end", "save"]);
  });

  it("marks a chapter read once and keeps the read set deduplicated", async () => {
    const markRead = vi.fn(async () => ({}));
    const { queryClient, store } = setupAccountStore({ markRead });

    store.markRead("chapter-2");
    store.markRead("chapter-2");

    expect(cachedState(queryClient).readChapterIds).toEqual(["chapter-1", "chapter-2"]);
    await flushPromises();
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it("adds a bookmark optimistically and swaps the temporary id for the stored one", async () => {
    const createBookmark = vi.fn(async () => ({ id: "stored-id", duplicate: false }));
    const { queryClient, store } = setupAccountStore({ createBookmark });

    expect(
      store.addBookmark({
        chapterId: "chapter-1",
        paragraphIndex: 4,
        column: "translated",
        excerpt: "excerpt",
      }),
    ).toBe(true);

    const optimistic = cachedState(queryClient).bookmarks;
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0].excerpt).toBe("excerpt");

    await flushPromises();
    expect(createBookmark).toHaveBeenCalledWith({
      novelId: "novel",
      chapterId: "chapter-1",
      paragraphIndex: 4,
      column: "translated",
      excerpt: "excerpt",
    });
    expect(cachedState(queryClient).bookmarks[0].id).toBe("stored-id");
  });

  it("keeps two in-flight bookmarks for different spots apart", async () => {
    const createBookmark = vi
      .fn()
      .mockResolvedValueOnce({ id: "first-id", duplicate: false })
      .mockResolvedValueOnce({ id: "second-id", duplicate: false });
    const { queryClient, store } = setupAccountStore({ createBookmark });
    const base = { chapterId: "chapter-1", column: null };

    store.addBookmark({ ...base, paragraphIndex: 4, excerpt: "first" });
    store.addBookmark({ ...base, paragraphIndex: 5, excerpt: "second" });

    const optimistic = cachedState(queryClient).bookmarks;
    expect(optimistic).toHaveLength(2);
    expect(new Set(optimistic.map((bookmark) => bookmark.id)).size).toBe(2);

    await flushPromises();
    await flushPromises();

    expect(
      cachedState(queryClient)
        .bookmarks.map((bookmark) => bookmark.id)
        .toSorted(),
    ).toEqual(["first-id", "second-id"]);
  });

  it("refuses a second bookmark for the same spot", async () => {
    const createBookmark = vi.fn(async () => ({ id: "stored-id", duplicate: false }));
    const { queryClient, store } = setupAccountStore({ createBookmark });
    const input = {
      chapterId: "chapter-1",
      paragraphIndex: 4,
      column: null,
      excerpt: "excerpt",
    };

    expect(store.addBookmark(input)).toBe(true);
    await flushPromises();
    expect(store.addBookmark(input)).toBe(false);

    expect(cachedState(queryClient).bookmarks).toHaveLength(1);
    expect(createBookmark).toHaveBeenCalledTimes(1);
  });

  it("drops the optimistic twin when the server already had the spot", async () => {
    const createBookmark = vi.fn(async () => ({ id: "existing-id", duplicate: true }));
    const { queryClient, store } = setupAccountStore({ createBookmark });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    store.addBookmark({
      chapterId: "chapter-1",
      paragraphIndex: 4,
      column: null,
      excerpt: "excerpt",
    });
    expect(cachedState(queryClient).bookmarks).toHaveLength(1);

    await flushPromises();
    await flushPromises();

    expect(cachedState(queryClient).bookmarks).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: readerStateQueryKey("novel") });
  });

  it("updates and removes bookmarks optimistically while persisting both", async () => {
    const updateBookmarkNote = vi.fn(async () => ({}));
    const removeBookmark = vi.fn(async () => ({}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey("novel"), {
      ...SERVER_STATE,
      bookmarks: [
        {
          id: "bookmark-1",
          chapterId: "chapter-1",
          paragraphIndex: 1,
          column: null,
          excerpt: "excerpt",
          note: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { updateBookmarkNote, removeBookmark },
    });

    store.updateBookmarkNote("bookmark-1", "a note");
    expect(cachedState(queryClient).bookmarks[0].note).toBe("a note");

    store.removeBookmark("bookmark-1");
    expect(cachedState(queryClient).bookmarks).toHaveLength(0);

    await flushPromises();
    expect(updateBookmarkNote).toHaveBeenCalledWith({ bookmarkId: "bookmark-1", note: "a note" });
    expect(removeBookmark).toHaveBeenCalledWith({ bookmarkId: "bookmark-1" });
  });

  it("resets the flush window when a new chapter opens", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const savePosition = vi.fn(async () => ({}));
    const setChapter = vi.fn(async () => ({}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey("novel"), SERVER_STATE);
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { savePosition, setChapter },
      now: () => clock,
    });

    store.markOpened("chapter-1");
    await vi.runOnlyPendingTimersAsync();

    store.saveScrollFraction(0.5);
    await vi.runOnlyPendingTimersAsync();
    expect(savePosition).toHaveBeenCalledTimes(1);

    // The second sample only arms the periodic flush.
    clock = 1_000;
    store.saveScrollFraction(0.6);
    expect(savePosition).toHaveBeenCalledTimes(1);

    store.markOpened("chapter-2");
    clock = 1_100;
    store.saveScrollFraction(0.2);
    await vi.runOnlyPendingTimersAsync();

    expect(savePosition).toHaveBeenLastCalledWith({
      novelId: "novel",
      chapterId: "chapter-2",
      scrollFraction: 0.2,
    });
    expect(savePosition).toHaveBeenCalledTimes(2);

    // The chapter-1 timer must not survive its chapter and flush chapter-2 later.
    await vi.runOnlyPendingTimersAsync();
    expect(savePosition).toHaveBeenCalledTimes(2);
  });

  it("resets the flush window when markRead moves to another chapter", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const savePosition = vi.fn(async () => ({}));
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey("novel"), SERVER_STATE);
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { savePosition, setChapter: async () => ({}), markRead: async () => ({}) },
      now: () => clock,
    });

    store.markOpened("chapter-1");
    await vi.runOnlyPendingTimersAsync();
    store.saveScrollFraction(0.5);
    await vi.runOnlyPendingTimersAsync();
    expect(savePosition).toHaveBeenCalledTimes(1);

    clock = 1_000;
    store.saveScrollFraction(0.6);

    store.markRead("chapter-2");
    clock = 1_100;
    store.saveScrollFraction(0.2);
    await vi.runOnlyPendingTimersAsync();

    expect(savePosition).toHaveBeenLastCalledWith({
      novelId: "novel",
      chapterId: "chapter-2",
      scrollFraction: 0.2,
    });
    await vi.runOnlyPendingTimersAsync();
    expect(savePosition).toHaveBeenCalledTimes(2);
  });

  it("resyncs the cached state when a write fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey("novel"), SERVER_STATE);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { setChapter: async () => Promise.reject(new Error("boom")) },
    });

    store.markOpened("chapter-2");
    await flushPromises();
    await flushPromises();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: readerStateQueryKey("novel") });
  });
});

describe("useReaderState", () => {
  function renderReaderState(novelId: string, isAdmin: boolean) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(readerStateQueryKey(novelId), SERVER_STATE);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useReaderState(novelId, isAdmin), { wrapper });
  }

  it("keeps the store and its methods stable across renders", () => {
    const { result, rerender } = renderReaderState("novel", false);
    const firstStore = result.current.store;
    const firstMarkOpened = result.current.markOpened;

    rerender();

    expect(result.current.store).toBe(firstStore);
    expect(result.current.markOpened).toBe(firstMarkOpened);
    expect(result.current.saveScrollFraction).toBe(firstStore.saveScrollFraction);
  });

  it("keeps the store stable after a write notifies subscribers", () => {
    const { result, rerender } = renderReaderState("novel", false);
    const firstStore = result.current.store;

    result.current.store.markOpened("chapter-7");
    rerender();

    expect(result.current.store).toBe(firstStore);
    expect(result.current.progress.readChapterIds).toEqual([]);
  });

  it("reads progress and bookmarks from the cached account state", () => {
    const { result } = renderReaderState("novel", true);

    expect(result.current.progress).toEqual({
      lastChapterId: "chapter-1",
      readChapterIds: ["chapter-1"],
      scrollFraction: 0.4,
    });
    expect(result.current.bookmarks).toEqual([]);
  });
});

describe("useReaderState bookmark paging", () => {
  const FIRST_CURSOR = { createdAt: "2026-01-01 00:00:00.123456", id: "bookmark-1" };

  function bookmark(id: string) {
    return {
      id,
      chapterId: "chapter-1",
      paragraphIndex: 1,
      column: null,
      excerpt: id,
      note: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  function renderPagingReader(isAdmin = true) {
    // Retries stay off so a failed page surfaces once, the way a user-visible retry behaves.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(readerStateQueryKey("novel"), {
      ...SERVER_STATE,
      bookmarks: [bookmark("bookmark-1")],
      bookmarkNextCursor: FIRST_CURSOR,
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return {
      queryClient,
      ...renderHook(({ novelId, isAdmin }) => useReaderState(novelId, isAdmin), {
        wrapper,
        initialProps: { novelId: "novel", isAdmin },
      }),
    };
  }

  afterEach(() => {
    bookmarkPages.clear();
  });

  it("appends the next page by id and advances the cursor", async () => {
    bookmarkPages.set("bookmark-1", async () => ({
      bookmarks: [bookmark("bookmark-2"), bookmark("bookmark-1"), bookmark("bookmark-3")],
      nextCursor: { createdAt: "2025-12-31 00:00:00", id: "bookmark-3" },
    }));
    const { queryClient, result } = renderPagingReader();

    expect(result.current.bookmarksHasMore).toBe(true);
    await act(async () => {
      await result.current.loadMoreBookmarks();
    });

    expect(cachedState(queryClient).bookmarks.map((entry) => entry.id)).toEqual([
      "bookmark-1",
      "bookmark-2",
      "bookmark-3",
    ]);
    expect(cachedState(queryClient).bookmarkNextCursor).toEqual({
      createdAt: "2025-12-31 00:00:00",
      id: "bookmark-3",
    });
    expect(result.current.bookmarksLoadingMore).toBe(false);
    expect(result.current.bookmarksLoadError).toBeNull();
  });

  it("keeps the loaded bookmarks and exposes a failed page for retry", async () => {
    bookmarkPages.set("bookmark-1", async () => {
      throw new Error("offline");
    });
    const { queryClient, result } = renderPagingReader();

    await act(async () => {
      await result.current.loadMoreBookmarks();
    });

    expect(cachedState(queryClient).bookmarks.map((entry) => entry.id)).toEqual(["bookmark-1"]);
    expect(cachedState(queryClient).bookmarkNextCursor).toEqual(FIRST_CURSOR);
    expect(result.current.bookmarksLoadError).toBeInstanceOf(Error);
    expect(result.current.bookmarksHasMore).toBe(true);
    expect(result.current.bookmarksLoadingMore).toBe(false);
  });

  it("does not start a second page request while one is in flight", async () => {
    const deferred = Promise.withResolvers<ReaderBookmarkPage>();
    let requests = 0;
    bookmarkPages.set("bookmark-1", () => {
      requests += 1;
      return deferred.promise;
    });
    const { result } = renderPagingReader();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.loadMoreBookmarks();
    });
    await act(async () => {
      await result.current.loadMoreBookmarks();
    });
    expect(requests).toBe(1);

    await act(async () => {
      deferred.resolve({ bookmarks: [], nextCursor: null });
      await pending;
    });
    expect(result.current.bookmarksLoadingMore).toBe(false);
  });

  it("discards a page response that arrives after the state was replaced", async () => {
    const deferred = Promise.withResolvers<ReaderBookmarkPage>();
    bookmarkPages.set("bookmark-1", () => deferred.promise);
    const { queryClient, result } = renderPagingReader();

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.loadMoreBookmarks();
    });

    // An authoritative refetch replaces accumulated pages with a fresh first page.
    queryClient.setQueryData(readerStateQueryKey("novel"), {
      ...SERVER_STATE,
      bookmarks: [bookmark("bookmark-9")],
      bookmarkNextCursor: null,
    });

    await act(async () => {
      deferred.resolve({ bookmarks: [bookmark("bookmark-2")], nextCursor: null });
      await pending;
    });

    expect(cachedState(queryClient).bookmarks.map((entry) => entry.id)).toEqual(["bookmark-9"]);
    expect(cachedState(queryClient).bookmarkNextCursor).toBeNull();
  });

  it("retains continuation after every loaded bookmark is removed", async () => {
    const { queryClient, result } = renderPagingReader();
    const store = createAccountReaderStore({
      novelId: "novel",
      queryClient,
      persist: { removeBookmark: async () => undefined },
    });

    await act(async () => {
      store.removeBookmark("bookmark-1");
      await flushPromises();
    });

    expect(result.current.bookmarks).toEqual([]);
    expect(result.current.bookmarksHasMore).toBe(true);
    bookmarkPages.set("bookmark-1", async () => ({
      bookmarks: [bookmark("older-bookmark")],
      nextCursor: null,
    }));
    await act(async () => {
      await result.current.loadMoreBookmarks();
    });
    expect(cachedState(queryClient).bookmarks.map((entry) => entry.id)).toEqual(["older-bookmark"]);
  });

  it("clears a page error when switching novels or leaving account mode", async () => {
    bookmarkPages.set("bookmark-1", async () => {
      throw new Error("offline");
    });
    const { queryClient, result, rerender } = renderPagingReader();
    queryClient.setQueryData(readerStateQueryKey("other-novel"), {
      ...SERVER_STATE,
      bookmarkNextCursor: FIRST_CURSOR,
    });

    await act(async () => {
      await result.current.loadMoreBookmarks();
    });
    expect(result.current.bookmarksLoadError).toBeInstanceOf(Error);
    rerender({ novelId: "other-novel", isAdmin: true });
    expect(result.current.bookmarksLoadError).toBeNull();
    expect(result.current.bookmarksLoadingMore).toBe(false);

    await act(async () => {
      await result.current.loadMoreBookmarks();
    });
    expect(result.current.bookmarksLoadError).toBeInstanceOf(Error);
    rerender({ novelId: "other-novel", isAdmin: false });
    expect(result.current.bookmarksHasMore).toBe(false);
    expect(result.current.bookmarksLoadError).toBeNull();
    expect(result.current.bookmarksLoadingMore).toBe(false);
  });

  it("does not let a previous novel's failed request release the current request guard", async () => {
    const previous = Promise.withResolvers<ReaderBookmarkPage>();
    const current = Promise.withResolvers<ReaderBookmarkPage>();
    bookmarkPages.set("bookmark-1", () => previous.promise);
    const loadCurrent = vi.fn(() => current.promise);
    bookmarkPages.set("other-cursor", loadCurrent);
    const { queryClient, result, rerender } = renderPagingReader();
    queryClient.setQueryData(readerStateQueryKey("other-novel"), {
      ...SERVER_STATE,
      bookmarkNextCursor: { ...FIRST_CURSOR, id: "other-cursor" },
    });
    let previousRequest!: Promise<void>;
    act(() => {
      previousRequest = result.current.loadMoreBookmarks();
    });
    expect(result.current.bookmarksLoadingMore).toBe(true);

    rerender({ novelId: "other-novel", isAdmin: true });
    expect(result.current.bookmarksLoadingMore).toBe(false);
    let currentRequest!: Promise<void>;
    act(() => {
      currentRequest = result.current.loadMoreBookmarks();
    });
    expect(result.current.bookmarksLoadingMore).toBe(true);
    await act(async () => {
      previous.reject(new Error("previous novel offline"));
      await previousRequest;
    });
    expect(result.current.bookmarksLoadError).toBeNull();
    expect(result.current.bookmarksLoadingMore).toBe(true);
    await act(async () => {
      await result.current.loadMoreBookmarks();
    });
    expect(loadCurrent).toHaveBeenCalledTimes(1);

    await act(async () => {
      current.resolve({ bookmarks: [bookmark("other-bookmark")], nextCursor: null });
      await currentRequest;
    });
    expect(result.current.bookmarksLoadingMore).toBe(false);
    expect(result.current.bookmarks.map((entry) => entry.id)).toEqual(["other-bookmark"]);
  });

  it("keeps guest paging neutral when an account request fails after switching modes", async () => {
    const deferred = Promise.withResolvers<ReaderBookmarkPage>();
    bookmarkPages.set("bookmark-1", () => deferred.promise);
    const { result, rerender } = renderPagingReader();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.loadMoreBookmarks();
    });
    expect(result.current.bookmarksLoadingMore).toBe(true);
    rerender({ novelId: "novel", isAdmin: false });
    expect(result.current.bookmarksLoadingMore).toBe(false);
    expect(result.current.bookmarksLoadError).toBeNull();
    await act(async () => {
      deferred.reject(new Error("account request failed"));
      await pending;
    });
    expect(result.current.bookmarksHasMore).toBe(false);
    expect(result.current.bookmarksLoadingMore).toBe(false);
    expect(result.current.bookmarksLoadError).toBeNull();
    rerender({ novelId: "novel", isAdmin: true });
    expect(result.current.bookmarksLoadError).toBeNull();
    expect(result.current.bookmarksLoadingMore).toBe(false);
  });

  it("keeps paging disabled for guests", async () => {
    const { result } = renderPagingReader(false);

    expect(result.current.bookmarksHasMore).toBe(false);
    await act(async () => {
      await result.current.loadMoreBookmarks();
    });

    expect(result.current.bookmarksLoadingMore).toBe(false);
    expect(result.current.bookmarksLoadError).toBeNull();
  });
});
