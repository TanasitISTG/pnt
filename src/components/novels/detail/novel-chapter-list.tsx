import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, FileText, Search, X } from "lucide-react";
import { useTranslations } from "use-intl";

import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReaderChapterRow } from "@/lib/content/chapter/chapter.functions";
import { filterChapters } from "@/lib/content/chapter/chapter-search";
import { cn } from "@/lib/utils";

const CHAPTER_GROUP_SIZE = 50;

export interface NovelChapterListProps {
  novelId: string;
  chapters: readonly ReaderChapterRow[];
  /** Chapters the viewer has finished, for the read marker. */
  readChapterIdSet: ReadonlySet<string>;
  /** The chapter the viewer was last in, marked as the current one. */
  currentChapterId: string | null;
  loading: boolean;
  /** The owner gets a way to add chapters from an empty list instead of a dead end. */
  canManage: boolean;
}

function ChapterRowLink({
  novelId,
  chapter,
  read,
  current,
}: {
  novelId: string;
  chapter: ReaderChapterRow;
  read: boolean;
  current: boolean;
}) {
  const t = useTranslations("novel");

  return (
    <Link
      to="/{-$locale}/novels/$novelId/chapters/$chapterId"
      params={{ novelId, chapterId: chapter.id }}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-md px-3 no-underline transition-colors duration-micro hover:bg-surface-inset",
        current && "bg-surface-inset",
      )}
    >
      <span className="w-10 shrink-0 font-mono text-caption tabular-nums text-muted-foreground">
        {Number(chapter.number)}
      </span>
      <span className="min-w-0 flex-1 whitespace-normal break-words text-body text-foreground [overflow-wrap:anywhere]">
        {chapter.translatedTitle ?? chapter.title}
      </span>
      {read ? (
        <span className="shrink-0 text-muted-foreground">
          <Check className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("readMarker")}</span>
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The novel's chapters as a reader reads them: numbers, translated titles, and a mark on
 * everything they have finished. It used to be the owner's dense management table shown to
 * everyone; the table stayed in the studio, and this is the reading list — grouped by fifty
 * like the reader's own chapter picker, so both lists scan the same way.
 */
export function NovelChapterList({
  novelId,
  chapters,
  readChapterIdSet,
  currentChapterId,
  loading,
  canManage,
}: NovelChapterListProps) {
  const t = useTranslations("novel");
  const [query, setQuery] = useState("");

  const filteredChapters = useMemo(() => filterChapters(chapters, query), [chapters, query]);
  const readCount = useMemo(
    () =>
      chapters.reduce(
        (count, chapter) => (readChapterIdSet.has(chapter.id) ? count + 1 : count),
        0,
      ),
    [chapters, readChapterIdSet],
  );
  const groups = useMemo(() => {
    const result: ReaderChapterRow[][] = [];
    for (let index = 0; index < filteredChapters.length; index += CHAPTER_GROUP_SIZE) {
      result.push(filteredChapters.slice(index, index + CHAPTER_GROUP_SIZE));
    }
    return result;
  }, [filteredChapters]);
  const currentGroupIndex = useMemo(() => {
    if (!currentChapterId) return 0;
    const index = filteredChapters.findIndex((chapter) => chapter.id === currentChapterId);
    return index >= 0 ? Math.floor(index / CHAPTER_GROUP_SIZE) : 0;
  }, [currentChapterId, filteredChapters]);
  const searching = query.trim().length > 0;

  return (
    <section aria-labelledby="novel-chapters-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="novel-chapters-heading"
          className="text-card-title font-semibold tracking-tight text-foreground"
        >
          {t("chapters")}
        </h2>
        {chapters.length > 0 ? (
          <p className="text-caption tabular-nums text-muted-foreground">
            {readCount > 0
              ? t("chaptersRead", { read: readCount, total: chapters.length })
              : t("chapterCount", { count: chapters.length })}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div
          className="rounded-xl border border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground"
          aria-live="polite"
        >
          {t("loadingChapters")}
        </div>
      ) : chapters.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-12 text-center">
          <FileText className="mb-2 size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {canManage ? t("emptyOwn") : t("emptyPublished")}
          </p>
          {canManage ? (
            <Button
              className="mt-5"
              render={<Link to="/novels/$novelId/manage/add" params={{ novelId }} />}
            >
              {t("addChapters")}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {chapters.length > CHAPTER_GROUP_SIZE || searching ? (
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchLabel")}
                className="h-11 pr-11 pl-9"
              />
              {query ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("clearSearch")}
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={() => setQuery("")}
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ) : null}

          {filteredChapters.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("noSearchMatches")}</p>
            </div>
          ) : groups.length <= 1 ? (
            <ul className="rounded-xl border border-border bg-card p-1.5">
              {groups[0]?.map((chapter) => (
                <li key={chapter.id}>
                  <ChapterRowLink
                    novelId={novelId}
                    chapter={chapter}
                    read={readChapterIdSet.has(chapter.id)}
                    current={chapter.id === currentChapterId}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-border bg-card px-1.5">
              <Accordion
                key={searching ? `search:${query}` : "all"}
                defaultValue={
                  searching ? groups.map((_, index) => String(index)) : [String(currentGroupIndex)]
                }
              >
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
                        <span className="font-normal text-muted-foreground tabular-nums">
                          ({group.length})
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionPanel>
                      <ul className="grid min-w-0 gap-0.5 pb-2">
                        {group.map((chapter) => (
                          <li key={chapter.id}>
                            <ChapterRowLink
                              novelId={novelId}
                              chapter={chapter}
                              read={readChapterIdSet.has(chapter.id)}
                              current={chapter.id === currentChapterId}
                            />
                          </li>
                        ))}
                      </ul>
                    </AccordionPanel>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}
        </>
      )}
    </section>
  );
}
