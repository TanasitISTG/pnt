import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, List } from "lucide-react";

import { Button } from "@/components/ui/button";
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
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-border pt-4">
      <div className="flex justify-start min-w-0">
        {prevChapter && (
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 max-w-full sm:max-w-64"
            onClick={() => onGoToChapter(prevChapter.id)}
            title={`Ch. ${Number(prevChapter.number)} — ${prevChapter.translatedTitle ?? prevChapter.title}`}
          >
            <ChevronLeft className="size-4 shrink-0" />
            <span className="truncate">
              {`Ch. ${Number(prevChapter.number)} — ${prevChapter.translatedTitle ?? prevChapter.title}`}
            </span>
          </Button>
        )}
      </div>
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          render={<Link to="/novels/$novelId" params={{ novelId }} />}
          aria-label="All chapters"
          title="All chapters"
        >
          <List className="size-4 sm:hidden" />
          <span className="hidden sm:inline">All chapters</span>
        </Button>
      </div>
      <div className="flex justify-end min-w-0">
        {nextChapter && (
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 max-w-full sm:max-w-64"
            onClick={() => onGoToChapter(nextChapter.id)}
            title={`Ch. ${Number(nextChapter.number)} — ${nextChapter.translatedTitle ?? nextChapter.title}`}
          >
            <span className="truncate">
              {`Ch. ${Number(nextChapter.number)} — ${nextChapter.translatedTitle ?? nextChapter.title}`}
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </Button>
        )}
      </div>
    </div>
  );
}
