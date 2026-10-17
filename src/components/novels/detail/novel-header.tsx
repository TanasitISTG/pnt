import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpen, ChevronDown } from "lucide-react";
import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FollowButton } from "@/components/novels/detail/follow-button";
import { NovelCover } from "@/components/novels/novel-cover";
import { ReportNovelButton } from "@/components/reports/report-novel-button";
import { NovelRatingSummary } from "@/components/reviews/novel-rating-summary";
import type { ChapterRow } from "@/components/chapters/types";
import { cn } from "@/lib/utils";
import type { getNovel } from "@/lib/content/novel/novel.functions";

type Novel = NonNullable<Awaited<ReturnType<typeof getNovel>>>;

const DESCRIPTION_COLLAPSE_THRESHOLD = 240;

export interface ReadingProgressSummary {
  readCount: number;
  totalCount: number;
  percent: number;
}

export interface NovelHeaderProps {
  novel: Novel;
  novelId: string;
  /** Any session at all: it decides whether following is a button or a door to sign in. */
  signedIn: boolean;
  /** The owner manages this novel in the studio, so following it is not offered to them. */
  isOwner: boolean;
  /** A member reading someone else's novel; the owner manages it in the studio instead. */
  canReport: boolean;
  chapters: ChapterRow[];
  chaptersPending: boolean;
  readingActionsPending: boolean;
  lastReadChapter: ChapterRow | null;
  firstChapter: ChapterRow | null;
  readingProgress: ReadingProgressSummary;
}

function NovelDescription({ description }: { description: string }) {
  const t = useTranslations("novel");
  const [expanded, setExpanded] = useState(false);
  const isLongDescription = description.length > DESCRIPTION_COLLAPSE_THRESHOLD;
  const descriptionClassName =
    "whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]";

  if (!isLongDescription) {
    return (
      <div className="mt-3 max-w-3xl">
        <p className={descriptionClassName}>{description}</p>
      </div>
    );
  }

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="mt-3 max-w-3xl">
      {!expanded ? <p className={cn(descriptionClassName, "line-clamp-4")}>{description}</p> : null}
      <CollapsibleContent>
        <p className={descriptionClassName}>{description}</p>
      </CollapsibleContent>
      <CollapsibleTrigger
        render={<Button type="button" variant="ghost" size="sm" className="-ml-3 mt-1 min-h-11" />}
      >
        {expanded ? t("showLess") : t("showMore")}
        <ChevronDown
          className={cn(
            "size-4 transition-transform motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
    </Collapsible>
  );
}

function NovelMeta({ novel, novelId }: Pick<NovelHeaderProps, "novel" | "novelId">) {
  const t = useTranslations("novel");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub md:text-section">
          {novel.title}
        </h1>
        <Badge variant="strongOutline" className="text-xs font-semibold uppercase">
          {novel.sourceLang} → {novel.targetLang}
        </Badge>
      </div>
      {/* Renders nothing until the novel has a rating, so a fresh novel never shows 0.0. */}
      <NovelRatingSummary novelId={novelId} className="mt-2" />
      {novel.originalTitle ? (
        <p className="mt-1 text-body font-medium text-muted-foreground">{novel.originalTitle}</p>
      ) : null}
      {novel.author ? (
        <p className="mt-0.5 text-sm text-muted-foreground">
          {/*
           * The author line is the one link that leads to the rest of their work. It is a
           * link only when a canonical author exists, because `/authors/:id` is an entity:
           * a novel whose author text has no row would otherwise link to a page that is
           * not there.
           */}
          {novel.authorId ? (
            <Link
              to="/{-$locale}/authors/$authorId"
              params={{ authorId: novel.authorId }}
              className="rounded-sm underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t("byAuthor", { author: novel.author })}
            </Link>
          ) : (
            t("byAuthor", { author: novel.author })
          )}
        </p>
      ) : null}
      {novel.description ? (
        <NovelDescription key={novel.description} description={novel.description} />
      ) : null}
    </div>
  );
}

type ReadingActionsProps = Pick<
  NovelHeaderProps,
  | "novelId"
  | "chapters"
  | "chaptersPending"
  | "readingActionsPending"
  | "lastReadChapter"
  | "firstChapter"
  | "readingProgress"
>;

function ReadingActions({
  novelId,
  chapters,
  chaptersPending,
  readingActionsPending,
  lastReadChapter,
  firstChapter,
  readingProgress,
}: ReadingActionsProps) {
  const t = useTranslations("novel");

  if (readingActionsPending || chaptersPending) {
    return (
      <div
        className="h-10 w-48 motion-safe:animate-pulse rounded-md bg-surface-inset"
        aria-label={t("loadingActions")}
      />
    );
  }
  if (chapters.length === 0) return null;

  const continueChapter = lastReadChapter ?? firstChapter;
  if (!continueChapter) return null;

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="w-full sm:w-auto"
          render={
            <Link
              to="/{-$locale}/novels/$novelId/chapters/$chapterId"
              params={{ novelId, chapterId: continueChapter.id }}
            />
          }
        >
          <BookOpen className="size-4" />
          <span>{lastReadChapter ? t("continueReading") : t("startReading")}</span>
          {lastReadChapter ? (
            <span className="max-w-50 truncate text-xs font-normal opacity-75">
              ({lastReadChapter.translatedTitle ?? lastReadChapter.title})
            </span>
          ) : null}
        </Button>
        {lastReadChapter && firstChapter && lastReadChapter.id !== firstChapter.id ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            render={
              <Link
                to="/{-$locale}/novels/$novelId/chapters/$chapterId"
                params={{ novelId, chapterId: firstChapter.id }}
              />
            }
          >
            {t("readFirstChapter")}
          </Button>
        ) : null}
      </div>
      {readingProgress.totalCount > 0 ? (
        <div className="flex min-w-0 items-center gap-2">
          <Progress
            value={readingProgress.percent}
            className="h-1 min-w-0 max-w-48 flex-1"
            aria-label={t("readingProgressLabel")}
          />
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {t("readingProgress", {
              read: readingProgress.readCount,
              total: readingProgress.totalCount,
              percent: readingProgress.percent,
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The novel as a reader meets it: cover, title, the language pair it is being translated
 * into, the score, the description, and the way into the text. Everything the owner does to
 * the novel — publishing, exporting, editing, deleting — lives in the studio, so this page
 * shows one primary action instead of two toolbars.
 */
export function NovelHeader({
  novel,
  novelId,
  signedIn,
  isOwner,
  canReport,
  chapters,
  chaptersPending,
  readingActionsPending,
  lastReadChapter,
  firstChapter,
  readingProgress,
}: NovelHeaderProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* The owner gets neither control: reporting one's own novel is not a thing, and
          following it would only notify the author about their own work. */}
      {isOwner ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <FollowButton novelId={novelId} signedIn={signedIn} isOwner={isOwner} />
          {canReport ? <ReportNovelButton novelId={novelId} novelTitle={novel.title} /> : null}
        </div>
      )}
      <div className="grid grid-cols-[104px_1fr] items-start gap-4 md:grid-cols-[200px_1fr] md:gap-6">
        <div className="relative aspect-3/4 w-full overflow-hidden rounded-xl border border-border bg-foreground/3">
          <NovelCover
            novelId={novel.hasCover ? novel.id : null}
            coverVersion={novel.updatedAt}
            coverUrl={novel.coverUrl}
            coverSrcSet={novel.coverSrcSet}
            alt={novel.title}
            sizes="(max-width: 767px) 104px, 200px"
            priority
            className="h-full w-full object-cover"
            fallbackSize={16}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <NovelMeta novel={novel} novelId={novelId} />
          <ReadingActions
            novelId={novelId}
            chapters={chapters}
            chaptersPending={chaptersPending}
            readingActionsPending={readingActionsPending}
            lastReadChapter={lastReadChapter}
            firstChapter={firstChapter}
            readingProgress={readingProgress}
          />
        </div>
      </div>
    </div>
  );
}
