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
            className="h-auto min-h-11 w-full min-w-0 max-w-full justify-start gap-1.5 overflow-hidden px-2.5 py-1 text-left sm:gap-2 sm:px-3"
            onClick={() => onGoToChapter(prevChapter.id)}
            title={`Previous: ${chapterLabel(prevChapter)}`}
          >
            <ChevronLeft className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block text-caption text-muted-foreground">Previous chapter</span>
              <span className="block truncate">{chapterLabel(prevChapter)}</span>
            </span>
          </Button>
        ) : null}
        {nextChapter ? (
          <Button
            className={cn(
              "h-auto min-h-11 w-full min-w-0 max-w-full justify-end gap-1.5 overflow-hidden px-2.5 py-1 text-right sm:gap-2 sm:px-3",
              !prevChapter && "sm:col-start-2",
            )}
            onClick={() => onGoToChapter(nextChapter.id)}
            title={`Next: ${chapterLabel(nextChapter)}`}
          >
            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="block text-caption opacity-75">Next chapter</span>
              <span className="block truncate">{chapterLabel(nextChapter)}</span>
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
          </Button>
        ) : (
          <p
            className={cn(
              "flex min-h-11 min-w-0 max-w-full items-center justify-end overflow-hidden text-right text-sm text-muted-foreground",
              !prevChapter && "sm:col-start-2",
            )}
          >
            You’ve reached the last available chapter.
          </p>
        )}
      </div>
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="max-w-full"
          render={<Link to="/novels/$novelId" params={{ novelId }} />}
          aria-label="All chapters"
        >
          <List className="size-4" />
          All chapters
        </Button>
      </div>
    </footer>
  );
}

function chapterLabel(chapter: ReaderChapterSummary): string {
  return `Ch. ${Number(chapter.number)} — ${chapter.translatedTitle ?? chapter.title}`;
}
