import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  ReaderBookmark,
  ReaderBookmarkInput,
  ReaderNovelState,
  ReaderProgress,
} from "./types";
import {
  readerBookmarkPageQueryOptions,
  readerBookmarkPagesQueryKey,
  readerStateQueryKey,
  readerStateQueryOptions,
} from "./query";
import {
  addReaderBookmark,
  listReaderBookmarks,
  removeReaderBookmark,
  updateReaderBookmarkNote,
} from "./bookmarks";
import {
  getReaderProgress,
  markChapterOpened,
  markChapterRead,
  saveScrollPosition,
} from "./progress";
import { READER_BOOKMARKS_STORAGE_KEY, READER_PROGRESS_STORAGE_KEY } from "./storage";
import {
  createBookmark,
  deleteBookmark,
  markReaderChapterRead,
  saveReaderPosition,
  setReaderChapter,
  updateBookmarkNote,
} from "./reader.functions";
import { useHydrated } from "@/lib/use-hydrated";
import { nanoid } from "@/lib/utils";

const FLUSH_INTERVAL_MS = 4_000;
const FLUSH_DELTA = 0.02;

const EMPTY_STATE: ReaderNovelState = {
  lastChapterId: null,
  scrollFraction: null,
  readChapterIds: [],
  bookmarks: [],
  bookmarkNextCursor: null,
};

export interface ReaderProgressStore {
  getProgress(): ReaderProgress;
  markOpened(chapterId: string): void;
  markRead(chapterId: string): void;
  saveScrollFraction(fraction: number): void;
  flushScrollFraction(fraction: number, options?: { unload?: boolean }): void;
}

interface ReaderStateStore extends ReaderProgressStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): ReaderNovelState;
  getServerSnapshot(): ReaderNovelState;
  addBookmark(input: ReaderBookmarkInput): boolean;
  updateBookmarkNote(bookmarkId: string, note: string | null): void;
  removeBookmark(bookmarkId: string): void;
}

export interface ReaderStateApi extends ReaderProgressStore {
  novelId: string;
  ready: boolean;
  progress: ReaderProgress;
  bookmarks: ReaderBookmark[];
  // Bookmark list is paged; `hasMore` stays true until the server reports no next cursor.
  bookmarksHasMore: boolean;
  bookmarksLoadingMore: boolean;
  bookmarksLoadError: unknown;
  loadMoreBookmarks(): Promise<void>;
  store: ReaderProgressStore;
  addBookmark(input: ReaderBookmarkInput): boolean;
  updateBookmarkNote(bookmarkId: string, note: string | null): void;
  removeBookmark(bookmarkId: string): void;
}

export interface AccountReaderPersistence {
  setChapter(input: { novelId: string; chapterId: string }): Promise<unknown>;
  savePosition(input: {
    novelId: string;
    chapterId: string;
    scrollFraction: number;
  }): Promise<unknown>;
  markRead(input: { novelId: string; chapterId: string }): Promise<unknown>;
  createBookmark(
    input: ReaderBookmarkInput & { novelId: string },
  ): Promise<{ id: string; duplicate: boolean }>;
  updateBookmarkNote(input: { bookmarkId: string; note: string | null }): Promise<unknown>;
  removeBookmark(input: { bookmarkId: string }): Promise<unknown>;
}

const DEFAULT_PERSISTENCE: AccountReaderPersistence = {
  setChapter: (input) => setReaderChapter({ data: input }),
  savePosition: (input) => saveReaderPosition({ data: input }),
  markRead: (input) => markReaderChapterRead({ data: input }),
  createBookmark: (input) => createBookmark({ data: input }),
  updateBookmarkNote: (input) => updateBookmarkNote({ data: input }),
  removeBookmark: (input) => deleteBookmark({ data: input }),
};

function toProgress(state: ReaderNovelState): ReaderProgress {
  return {
    lastChapterId: state.lastChapterId,
    readChapterIds: state.readChapterIds,
    ...(state.scrollFraction !== null ? { scrollFraction: state.scrollFraction } : {}),
  };
}

function findBookmarkAtSpot(
  bookmarks: readonly ReaderBookmark[],
  input: ReaderBookmarkInput,
): ReaderBookmark | undefined {
  return bookmarks.find(
    (bookmark) =>
      bookmark.chapterId === input.chapterId &&
      bookmark.paragraphIndex === input.paragraphIndex &&
      bookmark.column === input.column,
  );
}

function localSnapshot(novelId: string): ReaderNovelState {
  const progress = getReaderProgress(novelId);
  return {
    lastChapterId: progress.lastChapterId,
    scrollFraction: progress.scrollFraction ?? null,
    readChapterIds: progress.readChapterIds,
    bookmarks: listReaderBookmarks(novelId),
    bookmarkNextCursor: null,
  };
}

export function createLocalReaderStore(novelId: string): ReaderStateStore {
  let snapshot: ReaderNovelState | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const store: ReaderStateStore = {
    getProgress: () => getReaderProgress(novelId),
    getSnapshot: () => {
      if (!snapshot) snapshot = localSnapshot(novelId);
      return snapshot;
    },
    getServerSnapshot: () => EMPTY_STATE,
    subscribe: (onChange) => {
      listeners.add(onChange);
      if (typeof window === "undefined") return () => {};
      const handleStorage = (event: StorageEvent) => {
        if (
          event.key !== READER_PROGRESS_STORAGE_KEY &&
          event.key !== READER_BOOKMARKS_STORAGE_KEY
        ) {
          return;
        }
        notify();
      };
      window.addEventListener("storage", handleStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", handleStorage);
      };
    },
    markOpened: (chapterId) => {
      markChapterOpened(novelId, chapterId);
      notify();
    },
    markRead: (chapterId) => {
      markChapterRead(novelId, chapterId);
      notify();
    },
    // Scroll samples stay out of the React snapshot so scrolling never re-renders the chapter.
    saveScrollFraction: (fraction) => saveScrollPosition(novelId, fraction),
    flushScrollFraction: (fraction) => saveScrollPosition(novelId, fraction),
    addBookmark: (input) => {
      if (findBookmarkAtSpot(listReaderBookmarks(novelId), input)) return false;
      addReaderBookmark(novelId, input);
      notify();
      return true;
    },
    updateBookmarkNote: (bookmarkId, note) => {
      updateReaderBookmarkNote(novelId, bookmarkId, note);
      notify();
    },
    removeBookmark: (bookmarkId) => {
      removeReaderBookmark(novelId, bookmarkId);
      notify();
    },
  };

  return store;
}

function readCachedState(queryClient: QueryClient, novelId: string): ReaderNovelState {
  return queryClient.getQueryData<ReaderNovelState>(readerStateQueryKey(novelId)) ?? EMPTY_STATE;
}

export function createAccountReaderStore({
  novelId,
  queryClient,
  persist = {},
  now = () => Date.now(),
}: {
  novelId: string;
  queryClient: QueryClient;
  persist?: Partial<AccountReaderPersistence>;
  now?: () => number;
}): ReaderStateStore {
  const write = { ...DEFAULT_PERSISTENCE, ...persist };
  let queue: Promise<unknown> = Promise.resolve();
  let localChapterId: string | null = null;
  let localFraction: number | null = null;
  let hasFlushed = false;
  let lastFlushedAt = 0;
  let lastFlushedFraction: number | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const invalidateBookmarkPages = () => {
    void queryClient.invalidateQueries({ queryKey: readerBookmarkPagesQueryKey(novelId) });
  };

  const enqueue = (task: () => Promise<unknown>) => {
    queue = queue.then(task).catch(() => {
      void queryClient.invalidateQueries({ queryKey: readerStateQueryKey(novelId) });
      invalidateBookmarkPages();
    });
    return queue;
  };

  // A chapter change must not inherit the previous chapter's flush window or timer.
  const resetThrottle = () => {
    hasFlushed = false;
    lastFlushedAt = 0;
    lastFlushedFraction = null;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const updateCache = (updater: (state: ReaderNovelState) => ReaderNovelState) => {
    const current = queryClient.getQueryData<ReaderNovelState>(readerStateQueryKey(novelId));
    if (!current) return;
    queryClient.setQueryData(readerStateQueryKey(novelId), updater(current));
  };

  const persistFraction = (fraction: number) => {
    hasFlushed = true;
    lastFlushedAt = now();
    lastFlushedFraction = fraction;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const chapterId = localChapterId;
    if (chapterId === null) return;
    enqueue(() => write.savePosition({ novelId, chapterId, scrollFraction: fraction }));
  };

  const store: ReaderStateStore = {
    getProgress: () => {
      const state = readCachedState(queryClient, novelId);
      if (
        localChapterId !== null &&
        state.lastChapterId === localChapterId &&
        localFraction !== null
      ) {
        return { ...toProgress(state), scrollFraction: localFraction };
      }
      return toProgress(state);
    },
    getSnapshot: () => readCachedState(queryClient, novelId),
    getServerSnapshot: () => EMPTY_STATE,
    subscribe: () => () => {},
    markOpened: (chapterId) => {
      const sameChapter = readCachedState(queryClient, novelId).lastChapterId === chapterId;
      localChapterId = chapterId;
      localFraction = null;
      resetThrottle();
      updateCache((state) => ({
        ...state,
        lastChapterId: chapterId,
        ...(sameChapter ? {} : { scrollFraction: null }),
      }));
      enqueue(() => write.setChapter({ novelId, chapterId }));
    },
    markRead: (chapterId) => {
      if (localChapterId !== chapterId) {
        localChapterId = chapterId;
        localFraction = null;
        resetThrottle();
      }
      updateCache((state) => ({
        ...state,
        lastChapterId: chapterId,
        readChapterIds: state.readChapterIds.includes(chapterId)
          ? state.readChapterIds
          : [...state.readChapterIds, chapterId],
      }));
      enqueue(() => write.markRead({ novelId, chapterId }));
    },
    saveScrollFraction: (fraction) => {
      localFraction = fraction;
      const moved =
        lastFlushedFraction === null || Math.abs(fraction - lastFlushedFraction) >= FLUSH_DELTA;
      const elapsed = now() - lastFlushedAt >= FLUSH_INTERVAL_MS;
      if (!moved && !elapsed) return;
      if (hasFlushed && !elapsed) {
        if (pendingTimer === null) {
          pendingTimer = setTimeout(() => {
            pendingTimer = null;
            if (localFraction !== null) persistFraction(localFraction);
          }, FLUSH_INTERVAL_MS);
        }
        return;
      }
      persistFraction(fraction);
    },
    flushScrollFraction: (fraction, options) => {
      localFraction = fraction;
      // A request started while the page unloads is aborted by the browser; the last
      // periodic flush stands instead of a write that can never land.
      if (options?.unload) return;
      persistFraction(fraction);
    },
    addBookmark: (input) => {
      if (findBookmarkAtSpot(readCachedState(queryClient, novelId).bookmarks, input)) return false;

      // A unique temp id keeps two in-flight adds for the same paragraph apart until both
      // server ids arrive.
      const tempId = `pending-${nanoid()}`;
      updateCache((state) => ({
        ...state,
        bookmarks: [
          {
            id: tempId,
            chapterId: input.chapterId,
            paragraphIndex: input.paragraphIndex,
            column: input.column,
            excerpt: input.excerpt,
            note: input.note ?? null,
            createdAt: new Date().toISOString(),
          },
          ...state.bookmarks,
        ],
      }));
      enqueue(async () => {
        const created = await write.createBookmark({ ...input, novelId });
        if (created.duplicate) {
          // The server already had this spot: drop the optimistic twin and take its state.
          queryClient.setQueryData<ReaderNovelState>(readerStateQueryKey(novelId), (state) =>
            state ? { ...state, bookmarks: state.bookmarks.filter((b) => b.id !== tempId) } : state,
          );
          await queryClient.invalidateQueries({ queryKey: readerStateQueryKey(novelId) });
          invalidateBookmarkPages();
          return;
        }
        queryClient.setQueryData<ReaderNovelState>(readerStateQueryKey(novelId), (state) => {
          if (!state) return state;
          // The stored row may already be inside a loaded continuation page; adopting its id
          // again would leave a second optimistic twin behind.
          const alreadyLoaded = state.bookmarks.some((bookmark) => bookmark.id === created.id);
          return {
            ...state,
            bookmarks: alreadyLoaded
              ? state.bookmarks.filter((bookmark) => bookmark.id !== tempId)
              : state.bookmarks.map((bookmark) =>
                  bookmark.id === tempId ? { ...bookmark, id: created.id } : bookmark,
                ),
          };
        });
        invalidateBookmarkPages();
      });
      return true;
    },
    updateBookmarkNote: (bookmarkId, note) => {
      updateCache((state) => ({
        ...state,
        bookmarks: state.bookmarks.map((bookmark) =>
          bookmark.id === bookmarkId ? { ...bookmark, note } : bookmark,
        ),
      }));
      enqueue(async () => {
        await write.updateBookmarkNote({ bookmarkId, note });
        invalidateBookmarkPages();
      });
    },
    removeBookmark: (bookmarkId) => {
      updateCache((state) => ({
        ...state,
        bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
      }));
      enqueue(async () => {
        await write.removeBookmark({ bookmarkId });
        invalidateBookmarkPages();
      });
    },
  };

  return store;
}

export function useReaderState(novelId: string, isAdmin: boolean): ReaderStateApi {
  const queryClient = useQueryClient();
  const hydrated = useHydrated();

  const store = useMemo(
    () =>
      isAdmin
        ? createAccountReaderStore({ novelId, queryClient })
        : createLocalReaderStore(novelId),
    [isAdmin, novelId, queryClient],
  );

  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, store.getServerSnapshot);

  const query = useQuery({ ...readerStateQueryOptions(novelId), enabled: isAdmin });
  const accountState = isAdmin ? (query.data ?? EMPTY_STATE) : EMPTY_STATE;
  const state = isAdmin ? accountState : snapshot;
  const ready = isAdmin ? query.isSuccess || query.isError : hydrated;

  const [bookmarksLoadingMore, setBookmarksLoadingMore] = useState(false);
  const [bookmarksLoadError, setBookmarksLoadError] = useState<unknown>(null);
  const loadingMoreRef = useRef(false);
  const pagingGenerationRef = useRef(0);

  useEffect(() => {
    setBookmarksLoadError(null);
    setBookmarksLoadingMore(false);
    loadingMoreRef.current = false;
    return () => {
      pagingGenerationRef.current += 1;
    };
  }, [novelId, isAdmin]);

  // Continuation stays in the authoritative reader-state cache. A response only lands while
  // that cache still holds the cursor it was requested for and no refetch intervened, so a
  // late page can never overwrite newer state; the caller keeps the rows it already has.
  const loadMoreBookmarks = useCallback(async () => {
    if (!isAdmin || loadingMoreRef.current) return;
    const cursor =
      queryClient.getQueryData<ReaderNovelState>(readerStateQueryKey(novelId))
        ?.bookmarkNextCursor ?? null;
    if (!cursor) return;

    const generation = queryClient.getQueryState(readerStateQueryKey(novelId))?.dataUpdatedAt ?? 0;
    const pagingGeneration = pagingGenerationRef.current;
    loadingMoreRef.current = true;
    setBookmarksLoadingMore(true);
    setBookmarksLoadError(null);
    try {
      const page = await queryClient.fetchQuery(readerBookmarkPageQueryOptions(novelId, cursor));
      if (pagingGenerationRef.current !== pagingGeneration) return;
      const latest = queryClient.getQueryData<ReaderNovelState>(readerStateQueryKey(novelId));
      const latestCursor = latest?.bookmarkNextCursor ?? null;
      const latestGeneration =
        queryClient.getQueryState(readerStateQueryKey(novelId))?.dataUpdatedAt ?? 0;
      const stillExpected =
        latestCursor !== null &&
        latestCursor.createdAt === cursor.createdAt &&
        latestCursor.id === cursor.id;
      if (!latest || latestGeneration !== generation || !stillExpected) return;

      const loadedIds = new Set(latest.bookmarks.map((bookmark) => bookmark.id));
      queryClient.setQueryData<ReaderNovelState>(readerStateQueryKey(novelId), {
        ...latest,
        bookmarks: [
          ...latest.bookmarks,
          ...page.bookmarks.filter((bookmark) => !loadedIds.has(bookmark.id)),
        ],
        bookmarkNextCursor: page.nextCursor,
      });
    } catch (error) {
      if (pagingGenerationRef.current === pagingGeneration) setBookmarksLoadError(error);
    } finally {
      if (pagingGenerationRef.current === pagingGeneration) {
        loadingMoreRef.current = false;
        setBookmarksLoadingMore(false);
      }
    }
  }, [isAdmin, novelId, queryClient]);

  // `store` keeps its identity for a given (novel, reader) so effects can depend on it safely.
  return useMemo(
    () => ({
      novelId,
      store,
      ready,
      progress: toProgress(state),
      bookmarks: state.bookmarks,
      bookmarksHasMore: isAdmin && state.bookmarkNextCursor !== null,
      bookmarksLoadingMore: isAdmin && bookmarksLoadingMore,
      bookmarksLoadError: isAdmin ? bookmarksLoadError : null,
      loadMoreBookmarks,
      getProgress: store.getProgress,
      markOpened: store.markOpened,
      markRead: store.markRead,
      saveScrollFraction: store.saveScrollFraction,
      flushScrollFraction: store.flushScrollFraction,
      addBookmark: store.addBookmark,
      updateBookmarkNote: store.updateBookmarkNote,
      removeBookmark: store.removeBookmark,
    }),
    [
      bookmarksLoadError,
      bookmarksLoadingMore,
      isAdmin,
      loadMoreBookmarks,
      novelId,
      ready,
      state,
      store,
    ],
  );
}
