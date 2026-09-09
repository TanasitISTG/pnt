import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Edit,
  FileText,
  FileType,
  Loader2,
  MoreHorizontal,
  Network,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { NovelCover } from "@/components/novels/novel-cover";
import { PublishMenu } from "@/components/publish-menu";
import type { ChapterRow } from "@/components/chapters/types";
import { cn, formatCost, formatTokens } from "@/lib/utils";
import { parseLanguagePair } from "@/lib/translation/prompts/language";
import type { getNovel } from "@/lib/content/novel.functions";
import type { getGlossaryStats } from "@/lib/glossary/functions";
import type { getNovelCosts } from "@/lib/translation/api/queries";

type Novel = NonNullable<Awaited<ReturnType<typeof getNovel>>>;
type GlossaryStats = Awaited<ReturnType<typeof getGlossaryStats>> | undefined;
type CostData = Awaited<ReturnType<typeof getNovelCosts>> | undefined;

const DESCRIPTION_COLLAPSE_THRESHOLD = 240;

export interface NovelHeaderProps {
  novel: Novel;
  novelId: string;
  isAdmin: boolean;
  glossaryStats: GlossaryStats;
  costData: CostData;
  chapters: ChapterRow[];
  chaptersPending: boolean;
  readingActionsPending: boolean;
  lastReadChapter: ChapterRow | null;
  firstChapter: ChapterRow | null;
  exporting: "txt" | "epub" | null;
  publishingNovel: boolean;
  onPublishNovel: (publishedAt: Date | null) => void;
  onExportTxt: () => void;
  onExportEpub: () => void;
  onDeleteNovel: () => void;
}

type AdminActionsProps = Pick<
  NovelHeaderProps,
  | "novel"
  | "novelId"
  | "glossaryStats"
  | "exporting"
  | "publishingNovel"
  | "onPublishNovel"
  | "onExportTxt"
  | "onExportEpub"
  | "onDeleteNovel"
>;

function AdminActions({
  novel,
  novelId,
  glossaryStats,
  exporting,
  publishingNovel,
  onPublishNovel,
  onExportTxt,
  onExportEpub,
  onDeleteNovel,
}: AdminActionsProps) {
  const showRelationships = Boolean(parseLanguagePair(`${novel.sourceLang}->${novel.targetLang}`));

  return (
    <div className="flex w-full flex-wrap justify-end gap-1.5 sm:ml-auto sm:w-auto sm:gap-2">
      <PublishMenu
        publishedAt={novel.publishedAt}
        pending={publishingNovel}
        onChange={onPublishNovel}
        ariaLabel="Novel publishing options"
      />
      <Button
        variant="outline"
        size="sm"
        render={<Link to="/novels/$novelId/glossary" params={{ novelId }} />}
        aria-label="Glossary"
        title="Glossary"
      >
        <BookOpen className="size-4" />
        <span className="hidden sm:inline">Glossary</span>
        {glossaryStats && glossaryStats.total > 0 ? (
          <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-mono">
            {glossaryStats.total}
          </Badge>
        ) : null}
        {glossaryStats && glossaryStats.pending > 0 ? (
          <span className="ml-0.5 size-2 animate-pulse rounded-full bg-amber-500" />
        ) : null}
      </Button>
      {showRelationships ? (
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/novels/$novelId/relationships" params={{ novelId }} />}
          aria-label="Relationships"
          title="Character and relationship map"
        >
          <Network className="size-4" />
          <span className="hidden sm:inline">Relationships</span>
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" aria-label="Novel actions" />}
        >
          <MoreHorizontal className="size-4" />
          <span className="hidden sm:inline">More</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link to="/novels/$novelId/edit" params={{ novelId }} />}>
              <Edit className="size-4" />
              Edit novel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportTxt} disabled={exporting !== null}>
              <FileText className="size-4" />
              Novel as .txt
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportEpub} disabled={exporting !== null}>
              <FileType className="size-4" />
              Novel as .epub
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDeleteNovel}>
            <Trash2 className="size-4" />
            Delete novel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {exporting ? <Loader2 className="sr-only animate-spin" aria-label="Exporting" /> : null}
    </div>
  );
}

function NovelDescription({ description }: { description: string }) {
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
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 mt-1 min-h-11 px-3 text-foreground"
          />
        }
      >
        {expanded ? "Show less" : "Show more"}
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

function NovelMeta({ novel }: Pick<NovelHeaderProps, "novel">) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-card-title font-semibold tracking-tight text-foreground sm:text-sub md:text-section">
          {novel.title}
        </h1>
        <Badge variant="outline" className="border-foreground/40 text-xs font-semibold uppercase">
          {novel.sourceLang} → {novel.targetLang}
        </Badge>
      </div>
      {novel.originalTitle ? (
        <p className="mt-1 text-body font-medium text-muted-foreground">{novel.originalTitle}</p>
      ) : null}
      {novel.author ? (
        <p className="mt-0.5 text-sm text-muted-foreground">By {novel.author}</p>
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
>;

function ReadingActions({
  novelId,
  chapters,
  chaptersPending,
  readingActionsPending,
  lastReadChapter,
  firstChapter,
}: ReadingActionsProps) {
  if (readingActionsPending || chaptersPending) {
    return (
      <div
        className="h-10 w-48 animate-pulse rounded-md bg-muted"
        aria-label="Loading reading actions"
      />
    );
  }
  if (chapters.length === 0) return null;

  const continueChapter = lastReadChapter ?? firstChapter;
  if (!continueChapter) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <Button
        size="sm"
        className="w-full sm:w-auto"
        render={
          <Link
            to="/novels/$novelId/chapters/$chapterId"
            params={{ novelId, chapterId: continueChapter.id }}
          />
        }
      >
        <BookOpen className="size-4" />
        <span>{lastReadChapter ? "Continue reading" : "Start reading"}</span>
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
              to="/novels/$novelId/chapters/$chapterId"
              params={{ novelId, chapterId: firstChapter.id }}
            />
          }
        >
          Read first chapter
        </Button>
      ) : null}
    </div>
  );
}

type NovelProgressProps = Pick<NovelHeaderProps, "chapters" | "chaptersPending" | "costData">;

function NovelProgress({ chapters, chaptersPending, costData }: NovelProgressProps) {
  const translatedChapterCount = chaptersPending
    ? 0
    : chapters.filter((chapter) => chapter.status === "translated").length;
  const progressPercent =
    chaptersPending || chapters.length === 0
      ? 0
      : Math.round((translatedChapterCount / chapters.length) * 100);
  const hasUsage =
    costData && (costData.totals.promptTokens > 0 || costData.totals.completionTokens > 0);

  return (
    <div className="flex max-w-md flex-col gap-1.5 pt-2">
      <div className="flex justify-between text-caption text-muted-foreground">
        <span>Overall translation progress</span>
        <span>
          {chaptersPending
            ? "Loading chapter progress…"
            : `${progressPercent}% (${translatedChapterCount}/${chapters.length} chapters)`}
        </span>
      </div>
      <Progress value={chaptersPending ? null : progressPercent} className="h-2" />
      {hasUsage && costData ? (
        <div className="flex justify-between font-mono text-caption text-muted-foreground">
          <span>Translation usage</span>
          <span>
            {formatTokens(costData.totals.promptTokens)} in /{" "}
            {formatTokens(costData.totals.completionTokens)} out
            {costData.totals.cost != null ? ` · ${formatCost(costData.totals.cost)}` : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function NovelHeader({
  novel,
  novelId,
  isAdmin,
  glossaryStats,
  costData,
  chapters,
  chaptersPending,
  readingActionsPending,
  lastReadChapter,
  firstChapter,
  exporting,
  publishingNovel,
  onPublishNovel,
  onExportTxt,
  onExportEpub,
  onDeleteNovel,
}: NovelHeaderProps) {
  const adminActionsProps = {
    novel,
    novelId,
    glossaryStats,
    exporting,
    publishingNovel,
    onPublishNovel,
    onExportTxt,
    onExportEpub,
    onDeleteNovel,
  };
  const readingActionsProps = {
    novelId,
    chapters,
    chaptersPending,
    readingActionsPending,
    lastReadChapter,
    firstChapter,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <Button variant="ghost" size="icon" render={<Link to="/" />} aria-label="Go to Library">
          <ArrowLeft className="size-4" />
        </Button>
        {isAdmin ? <AdminActions {...adminActionsProps} /> : null}
      </div>
      <div className="grid grid-cols-[96px_1fr] items-start gap-4 md:grid-cols-[200px_1fr] md:gap-6">
        <div className="relative aspect-3/4 w-full overflow-hidden rounded-xl border border-border bg-foreground/3">
          <NovelCover
            novelId={novel.id}
            coverVersion={novel.updatedAt}
            alt={novel.title}
            sizes="(max-width: 767px) 96px, 200px"
            priority
            className="h-full w-full object-cover"
            fallbackSize={16}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <NovelMeta novel={novel} />
          <ReadingActions {...readingActionsProps} />
          {isAdmin ? (
            <NovelProgress
              chapters={chapters}
              chaptersPending={chaptersPending}
              costData={costData}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
