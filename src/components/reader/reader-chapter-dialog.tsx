import { useMemo, useState } from "react";
import { List, Search } from "lucide-react";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { filterChapters } from "@/lib/content/chapter-search";
import type { ReaderChapterSummary } from "./reader-toolbar";

const CHAPTER_GROUP_SIZE = 50;

export interface ReaderChapterDialogProps {
  chapters: ReaderChapterSummary[];
  chapterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoToChapter: (id: string) => void;
}

export function ReaderChapterDialog({
  chapters,
  chapterId,
  open,
  onOpenChange,
  onGoToChapter,
}: ReaderChapterDialogProps) {
  const currentChapter = chapters.find((chapter) => chapter.id === chapterId);
  const currentIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  const currentGroup = currentIndex >= 0 ? Math.floor(currentIndex / CHAPTER_GROUP_SIZE) : 0;
  const [query, setQuery] = useState("");
  const triggerLabel = currentChapter
    ? `Choose chapter: ${chapterLabel(currentChapter)}`
    : "Choose chapter";
  const filteredChapters = useMemo(() => filterChapters(chapters, query), [chapters, query]);
  const groups = useMemo(() => {
    const result: ReaderChapterSummary[][] = [];
    for (let index = 0; index < filteredChapters.length; index += CHAPTER_GROUP_SIZE) {
      result.push(filteredChapters.slice(index, index + CHAPTER_GROUP_SIZE));
    }
    return result;
  }, [filteredChapters]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setQuery("");
        onOpenChange(nextOpen);
      }}
    >
      <DialogTrigger
        render={<Button variant="ghost" size="icon" className="size-11 shrink-0" />}
        aria-label={triggerLabel}
        title={triggerLabel}
      >
        <List className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="z-[60] flex min-h-0 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden overscroll-contain">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Choose a chapter</DialogTitle>
          <DialogDescription>Search by number or title, then open a chapter.</DialogDescription>
        </DialogHeader>
        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chapters…"
            aria-label="Search chapters in picker"
            className="h-11 pl-9"
          />
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-1 pe-3 [scrollbar-gutter:stable]">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No chapters match your search.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : (
            <Accordion key={query} defaultValue={[query.trim() ? "0" : String(currentGroup)]}>
              {groups.map((group, groupIndex) => (
                <AccordionItem
                  key={`${groupIndex}-${group[0]?.id ?? "empty"}`}
                  value={String(groupIndex)}
                  className="min-w-0"
                >
                  <AccordionTrigger className="min-w-0">
                    <span className="min-w-0 flex-1">
                      Chapters {Number(group[0].number)}–{Number(group[group.length - 1].number)}{" "}
                      <span className="font-normal text-muted-foreground">({group.length})</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionPanel>
                    <div className="grid min-w-0 gap-1 pb-2">
                      {group.map((chapter) => (
                        <Button
                          key={chapter.id}
                          type="button"
                          variant={chapter.id === chapterId ? "outline" : "ghost"}
                          className="h-auto min-h-11 w-full min-w-0 items-start justify-start py-2 text-left"
                          aria-current={chapter.id === chapterId ? "page" : undefined}
                          onClick={() => {
                            setQuery("");
                            onOpenChange(false);
                            if (chapter.id !== chapterId) onGoToChapter(chapter.id);
                          }}
                        >
                          <span className="w-12 shrink-0 font-mono text-caption text-muted-foreground">
                            {Number(chapter.number)}
                          </span>
                          <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
                            {chapter.translatedTitle ?? chapter.title}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function chapterLabel(chapter: ReaderChapterSummary): string {
  return `Ch. ${Number(chapter.number)} — ${chapter.translatedTitle ?? chapter.title}`;
}
