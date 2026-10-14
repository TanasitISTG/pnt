import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, List } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReaderChapterSummary } from "./reader-toolbar";

export interface ReaderFooterNavProps {
  novelId: string;
  prevChapter: ReaderChapterSummary | null;
  nextChapter: ReaderChapterSummary | null;
  onGoToChapter: (id: string) => void;
}

/**
 * The end of a chapter is a fork, so the fork gets one obvious action: the next chapter,
 * named. Continuing is what most readers do here, and the chapter they are about to open
 * is worth more than the word "Next".
 */
export function ReaderFooterNav({
  novelId,
  prevChapter,
  nextChapter,
  onGoToChapter,
}: ReaderFooterNavProps) {
  return (
    <footer className="flex min-w-0 max-w-full flex-col gap-4 border-t border-border pt-6">
      <div className="grid min-w-0 max-w-full gap-3 sm:grid-cols-2">
        {prevChapter ? (
          <Button
            variant="outline"
            size="readerNav"
            className="w-full min-w-0 max-w-full justify-start overflow-hidden text-left"
            onClick={() => onGoToChapter(prevChapter.id)}
            title={`Previous: ${chapterLabel(prevChapter)}`}
          >
            <ChevronLeft className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block text-caption text-muted-foreground">Previous chapter</span>
              <span className="block truncate">{chapterLabel(prevChapter)}</span>
            </span>
          </Button>
        ) : null}
        {nextChapter ? (
          <Button
            size="readerNav"
            className={cn(
              "w-full min-w-0 max-w-full justify-end overflow-hidden text-right",
              !prevChapter && "sm:col-start-2",
            )}
            onClick={() => onGoToChapter(nextChapter.id)}
            title={`Up next: ${chapterLabel(nextChapter)}`}
          >
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block text-caption opacity-75">Up next</span>
              <span className="block truncate">{chapterLabel(nextChapter)}</span>
            </span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          </Button>
        ) : (
          <p
            className={cn(
              "flex min-h-11 min-w-0 max-w-full items-center justify-end overflow-hidden text-right text-body text-muted-foreground",
              !prevChapter && "sm:col-start-2",
            )}
          >
            This is the last available chapter.
          </p>
        )}
      </div>
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="max-w-full"
          render={<Link to="/{-$locale}/novels/$novelId" params={{ novelId }} />}
          aria-label="All chapters"
        >
          <List className="size-4" aria-hidden="true" />
          All chapters
        </Button>
      </div>
    </footer>
  );
}

function chapterLabel(chapter: ReaderChapterSummary): string {
  return `Ch. ${Number(chapter.number)}: ${chapter.translatedTitle ?? chapter.title}`;
}
