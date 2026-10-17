import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { chapterQueryOptions } from "@/lib/content/chapter/chapter.query";
import type { ReaderBookmark } from "@/lib/reader/types";
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
  signedIn: boolean;
  editing: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoToChapter: (chapterId: string, hash?: string) => void;
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
  signedIn,
  editing,
  open,
  onOpenChange,
  onGoToChapter,
}: ReaderBookmarksDialogProps) {
  const t = useTranslations("reader");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  // The bookmark list names each chapter above the excerpt the reader is choosing between.
  const chapterLabel = (id: string) => {
    const chapter = chapters.find((item) => item.id === id);
    if (!chapter) return t("chapterFallback");
    return t("bookmarkChapterLabel", {
      number: Number(chapter.number),
      title: chapter.translatedTitle ?? chapter.title,
    });
  };
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
      toast.error(t("bookmarkScrollFirst"));
      return;
    }
    const excerpt = buildBookmarkExcerpt(target.element, target.text);
    if (!excerpt) {
      toast.error(t("bookmarkNothingHere"));
      return;
    }
    const added = readerState.addBookmark({
      chapterId,
      paragraphIndex: target.paragraphIndex,
      column: target.column,
      excerpt,
    });
    if (added) {
      toast.success(t("bookmarkSaved"));
    } else {
      toast.info(t("bookmarkExists"));
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
      <DialogContent className="z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>{t("bookmarksTitle")}</DialogTitle>
          <DialogDescription>
            {signedIn ? t("bookmarksSynced") : t("bookmarksLocalOnly")}
          </DialogDescription>
        </DialogHeader>

        <Button type="button" onClick={handleBookmarkThisSpot} disabled={editing}>
          <Bookmark className="size-4" aria-hidden="true" />
          {t("bookmarkThisSpot")}
        </Button>

        {sortedBookmarks.length === 0 ? (
          !readerState.bookmarksHasMore && !readerState.bookmarksLoadError ? (
            <p className="text-sm text-muted-foreground">{t("bookmarksEmpty")}</p>
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
                      {chapterLabel(bookmark.chapterId)}
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
                          aria-label={t("bookmarkNoteLabel")}
                          rows={3}
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" onClick={() => handleSaveNote(bookmark.id)}>
                            <Check className="size-4" aria-hidden="true" />
                            {t("saveNote")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingNoteId(null);
                              setNoteDraft("");
                            }}
                          >
                            {tCommon("cancel")}
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
                          {t("goToBookmark")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingNoteId(bookmark.id);
                            setNoteDraft(bookmark.note ?? "");
                          }}
                        >
                          {bookmark.note ? t("editNote") : t("addNote")}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="ml-auto"
                          aria-label={t("deleteBookmark")}
                          title={t("deleteBookmark")}
                          onClick={() => {
                            readerState.removeBookmark(bookmark.id);
                            toast.success(t("bookmarkRemoved"));
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
            <p className="text-caption text-destructive-text">{t("bookmarksLoadFailed")}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void readerState.loadMoreBookmarks()}
            >
              {t("retry")}
            </Button>
          </div>
        ) : readerState.bookmarksHasMore ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-muted-foreground">
              {t("loadedCount", { count: sortedBookmarks.length })}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={readerState.bookmarksLoadingMore}
              onClick={() => void readerState.loadMoreBookmarks()}
            >
              {readerState.bookmarksLoadingMore ? t("loading") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
