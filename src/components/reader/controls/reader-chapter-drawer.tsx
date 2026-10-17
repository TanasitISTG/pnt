import { useMemo, useState, type ReactElement } from "react";
import { useTranslations } from "use-intl";
import { Check, Search } from "lucide-react";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { filterChapters } from "@/lib/content/chapter/chapter-search";
import type { ReaderChapterSummary } from "./reader-toolbar";

const CHAPTER_GROUP_SIZE = 50;

export interface ReaderChapterDrawerProps {
  chapters: ReaderChapterSummary[];
  chapterId: string;
  /** Chapters the viewer has finished, for the read marker. */
  readChapterIdSet: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGoToChapter: (id: string) => void;
  /** The control that opens the drawer: an icon in the toolbar, a labelled button on a phone. */
  trigger: ReactElement;
  /** `end` on a pointer screen, `bottom` on a phone. */
  side?: "end" | "bottom";
}

/**
 * The chapter list, as a drawer: search, 50-chapter groups, read markers. It replaced a
 * centred dialog — a list you navigate through wants an edge it came from and the
 * gesture of a flick to dismiss it.
 */
export function ReaderChapterDrawer({
  chapters,
  chapterId,
  readChapterIdSet,
  open,
  onOpenChange,
  onGoToChapter,
  trigger,
  side = "end",
}: ReaderChapterDrawerProps) {
  const t = useTranslations("reader");
  const chapterLabel = (chapter: ReaderChapterSummary) =>
    t("chapterLabel", {
      number: Number(chapter.number),
      title: chapter.translatedTitle ?? chapter.title,
    });
  const currentChapter = chapters.find((chapter) => chapter.id === chapterId);
  const currentIndex = chapters.findIndex((chapter) => chapter.id === chapterId);
  const currentGroup = currentIndex >= 0 ? Math.floor(currentIndex / CHAPTER_GROUP_SIZE) : 0;
  const [query, setQuery] = useState("");
  const filteredChapters = useMemo(() => filterChapters(chapters, query), [chapters, query]);
  const groups = useMemo(() => {
    const result: ReaderChapterSummary[][] = [];
    for (let index = 0; index < filteredChapters.length; index += CHAPTER_GROUP_SIZE) {
      result.push(filteredChapters.slice(index, index + CHAPTER_GROUP_SIZE));
    }
    return result;
  }, [filteredChapters]);

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setQuery("");
        onOpenChange(nextOpen);
      }}
      swipeDirection={side === "bottom" ? "down" : "right"}
    >
      <DrawerTrigger render={trigger} />
      <DrawerContent side={side}>
        <DrawerHeader>
          <DrawerTitle>{t("chapterListTitle")}</DrawerTitle>
          <DrawerDescription>
            {currentChapter
              ? t("readingChapter", { chapter: chapterLabel(currentChapter) })
              : t("chooseChapter")}
          </DrawerDescription>
        </DrawerHeader>
        <div className="shrink-0 px-5 pt-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchChaptersPlaceholder")}
              aria-label={t("searchChaptersLabel")}
              className="h-11 pl-9"
            />
          </div>
        </div>
        <DrawerBody>
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-body text-muted-foreground">{t("noChapterMatches")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>
                {t("clearSearch")}
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
                      {t("chapterGroup", {
                        from: Number(group[0].number),
                        to: Number(group[group.length - 1].number),
                      })}{" "}
                      <span className="font-normal text-muted-foreground">({group.length})</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionPanel>
                    <div className="grid min-w-0 gap-1 pb-2">
                      {group.map((chapter) => {
                        const current = chapter.id === chapterId;
                        const read = readChapterIdSet.has(chapter.id);
                        return (
                          <Button
                            key={chapter.id}
                            type="button"
                            variant={current ? "outline" : "ghost"}
                            size="chapterOption"
                            className="w-full min-w-0 items-start justify-start text-left"
                            aria-current={current ? "page" : undefined}
                            onClick={() => {
                              setQuery("");
                              onOpenChange(false);
                              if (!current) onGoToChapter(chapter.id);
                            }}
                          >
                            <span className="w-12 shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
                              {Number(chapter.number)}
                            </span>
                            <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
                              {chapter.translatedTitle ?? chapter.title}
                            </span>
                            {read ? (
                              <span className="shrink-0 self-center text-muted-foreground">
                                <Check className="size-4" aria-hidden="true" />
                                <span className="sr-only">{t("readMarker")}</span>
                              </span>
                            ) : null}
                          </Button>
                        );
                      })}
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
