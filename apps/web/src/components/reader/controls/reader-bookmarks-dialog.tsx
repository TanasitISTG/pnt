import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { chapterQueryOptions } from "@/lib/content/chapter/chapter.query";
import type { ReaderBookmark } from "@pnt/contracts/reader";
import type { ReaderStateApi } from "@/lib/reader/use-reader-state";
import {
  bookmarkAnchorId,
  buildBookmarkExcerpt,
  findReaderAnchor,
  resolveBookmarkParagraphIndex,
  resolveBookmarkTarget,
} from "@/components/reader/page/reader-anchors";
import type { ReaderChapterSummary } from "./reader-toolbar";

export interface ReaderBookmarksDialogProps {
  chapterId: string;
  chapters: ReaderChapterSummary[];
  readerState: ReaderStateApi;
  isAdmin: boolean;
  editing: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoToChapter: (chapterId: string, hash?: string) => void;
}

function chapterLabel(chapters: ReaderChapterSummary[], chapterId: string): string {
  const chapter = chapters.find((item) => item.id === chapterId);
  if (!chapter) return "Chapter";
  const title = chapter.translatedTitle ?? chapter.title;
  return `Ch. ${Number(chapter.number)} · ${title}`;
}

function sortBookmarks(
  bookmarks: ReaderBookmark[],
  chapters: ReaderChapterSummary[],
): ReaderBookmark[] {
  const order = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  return bookmarks.toSorted((a, b) => {
    const aOrder = order.get(a.chapterId) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(b.chapterId) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.paragraphIndex - b.paragraphIndex;
  });
}

export function ReaderBookmarksDialog({
  chapterId,
  chapters,
  readerState,
  isAdmin,
  editing,
  open,
  onOpenChange,
  onGoToChapter,
}: ReaderBookmarksDialogProps) {
  const queryClient = useQueryClient();
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const { bookmarks } = readerState;
  const sortedBookmarks = useMemo(() => sortBookmarks(bookmarks, chapters), [bookmarks, chapters]);

  const goToBookmark = async (bookmark: ReaderBookmark) => {
    const paragraphIndex = await resolveBookmarkParagraphIndex(
      (targetChapterId) =>
        queryClient.ensureQueryData(chapterQueryOptions(targetChapterId, readerState.novelId)),
      bookmark,
    );
    const anchor = bookmarkAnchorId(paragraphIndex);
    // Navigating to an unchanged hash is a no-op for the router, so a bookmark in the open
    // chapter scrolls itself; the navigation still updates the address.
    if (bookmark.chapterId === chapterId) {
      findReaderAnchor(anchor)?.scrollIntoView({
        block: "start",
        behavior: "instant" as ScrollBehavior,
      });
    }
    onGoToChapter(bookmark.chapterId, anchor);
  };

  const handleBookmarkThisSpot = () => {
    const target = resolveBookmarkTarget();
    if (!target) {
      toast.error("Scroll to a paragraph first");
      return;
    }
    const excerpt = buildBookmarkExcerpt(target.element, target.text);
    if (!excerpt) {
      toast.error("Nothing to bookmark here");
      return;
    }
    const added = readerState.addBookmark({
      chapterId,
      paragraphIndex: target.paragraphIndex,
      column: target.column,
      excerpt,
    });
    if (added) {
      toast.success("Bookmark saved");
    } else {
      toast.info("Already bookmarked here");
    }
  };

  const handleSaveNote = (bookmarkId: string) => {
    const note = noteDraft.trim();
    readerState.updateBookmarkNote(bookmarkId, note.length > 0 ? note : null);
    setEditingNoteId(null);
    setNoteDraft("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}
        aria-label="Bookmarks"
        title="Bookmarks"
      >
        <Bookmark className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>Bookmarks</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? "Bookmarks are saved to your account and sync across devices."
              : "Bookmarks are stored in this browser only."}
          </DialogDescription>
        </DialogHeader>

        <Button type="button" onClick={handleBookmarkThisSpot} disabled={editing}>
          <Bookmark className="size-4" aria-hidden="true" />
          Bookmark this spot
        </Button>

        {sortedBookmarks.length === 0 ? (
          !readerState.bookmarksHasMore && !readerState.bookmarksLoadError ? (
            <p className="text-sm text-muted-foreground">
              No bookmarks yet. Open this dialog while reading a paragraph you want to keep.
            </p>
          ) : null
        ) : (
          <ul className="flex flex-col gap-3">
            {sortedBookmarks.map((bookmark, index) => {
              const showChapter =
                index === 0 || sortedBookmarks[index - 1].chapterId !== bookmark.chapterId;
              return (
                <li key={bookmark.id} className="flex flex-col gap-2">
                  {showChapter ? (
                    <p className="text-caption font-medium text-muted-foreground">
                      {chapterLabel(chapters, bookmark.chapterId)}
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <p className="min-w-0 text-sm text-foreground">{bookmark.excerpt}</p>
                    {bookmark.note && editingNoteId !== bookmark.id ? (
                      <p className="whitespace-pre-wrap text-caption text-muted-foreground">
                        {bookmark.note}
                      </p>
                    ) : null}
                    {editingNoteId === bookmark.id ? (
                      <div className="flex flex-col gap-2">
                        <Textarea
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          aria-label="Bookmark note"
                          rows={3}
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => handleSaveNote(bookmark.id)}>
                            <Check className="size-4" aria-hidden="true" />
                            Save note
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingNoteId(null);
                              setNoteDraft("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            onOpenChange(false);
                            void goToBookmark(bookmark);
                          }}
                        >
                          Go to
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingNoteId(bookmark.id);
                            setNoteDraft(bookmark.note ?? "");
                          }}
                        >
                          {bookmark.note ? "Edit note" : "Add note"}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="ml-auto"
                          aria-label="Delete bookmark"
                          title="Delete bookmark"
                          onClick={() => {
                            readerState.removeBookmark(bookmark.id);
                            toast.success("Bookmark removed");
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {readerState.bookmarksLoadError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-destructive-text">Could not load more bookmarks.</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void readerState.loadMoreBookmarks()}
            >
              Retry
            </Button>
          </div>
        ) : readerState.bookmarksHasMore ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-muted-foreground">{sortedBookmarks.length} loaded</p>
            <Button
              size="sm"
              variant="outline"
              disabled={readerState.bookmarksLoadingMore}
              onClick={() => void readerState.loadMoreBookmarks()}
            >
              {readerState.bookmarksLoadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
