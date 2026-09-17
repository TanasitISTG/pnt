// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderBookmark } from "@/lib/reader/types";
import type { ReaderStateApi } from "@/lib/reader/use-reader-state";
import { ReaderBookmarksDialog } from "./reader-bookmarks-dialog";

const BOOKMARK: ReaderBookmark = {
  id: "bookmark-1",
  chapterId: "chapter-1",
  paragraphIndex: 0,
  column: null,
  excerpt: "The newest saved paragraph",
  note: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function DialogHarness({
  initialBookmarks = [BOOKMARK],
  hasMore = true,
  error = null,
  loadMore = async () => undefined,
}: {
  initialBookmarks?: ReaderBookmark[];
  hasMore?: boolean;
  error?: unknown;
  loadMore?: () => Promise<void>;
}) {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const progress = { lastChapterId: "chapter-1", readChapterIds: [] };
  const store = {
    getProgress: () => progress,
    markOpened: () => undefined,
    markRead: () => undefined,
    saveScrollFraction: () => undefined,
    flushScrollFraction: () => undefined,
  };
  const readerState: ReaderStateApi = {
    ...store,
    novelId: "novel",
    ready: true,
    progress,
    store,
    bookmarks,
    bookmarksHasMore: hasMore,
    bookmarksLoadingMore: false,
    bookmarksLoadError: error,
    loadMoreBookmarks: loadMore,
    addBookmark: () => false,
    updateBookmarkNote: () => undefined,
    removeBookmark: (id) => setBookmarks((current) => current.filter((entry) => entry.id !== id)),
  };
  return (
    <ReaderBookmarksDialog
      chapterId="chapter-1"
      chapters={[{ id: "chapter-1", number: "1", title: "Chapter one", translatedTitle: null }]}
      readerState={readerState}
      isAdmin
      editing={false}
      open
      onOpenChange={() => undefined}
      onGoToChapter={() => undefined}
    />
  );
}

function renderDialog(props: Parameters<typeof DialogHarness>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogHarness {...props} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("ReaderBookmarksDialog pagination", () => {
  it("keeps older bookmarks reachable after the last loaded bookmark is removed", async () => {
    const loadMore = vi.fn(async () => undefined);
    renderDialog({ loadMore });
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Delete bookmark" }));

    expect(dialog.queryByText(BOOKMARK.excerpt)).toBeNull();
    expect(dialog.queryByText(/No bookmarks yet/)).toBeNull();
    expect(dialog.getByText("0 loaded")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Load more" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it("offers retry even when no bookmarks or continuation cursor remain", async () => {
    const loadMore = vi.fn(async () => undefined);
    renderDialog({ initialBookmarks: [], hasMore: false, error: new Error("offline"), loadMore });
    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.queryByText(/No bookmarks yet/)).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Retry" }));
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it("shows a true empty state only after pagination is exhausted without an error", async () => {
    renderDialog({ initialBookmarks: [], hasMore: false });
    const dialog = within(await screen.findByRole("dialog"));

    expect(dialog.getByText(/No bookmarks yet/)).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(dialog.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
