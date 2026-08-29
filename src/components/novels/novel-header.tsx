import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpen,
  Download,
  Edit,
  FileText,
  FileType,
  Loader2,
  Network,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { NovelCover } from "@/components/novels/novel-cover";
import { PublishMenu } from "@/components/publish-menu";
import type { ChapterRow } from "@/components/chapters/types";
import { formatCost, formatTokens } from "@/lib/utils";
import type { getNovel } from "@/lib/content/novel.functions";
import type { getGlossaryStats } from "@/lib/glossary/functions";
import type { getNovelCosts } from "@/lib/translation/api/queries";

type Novel = NonNullable<Awaited<ReturnType<typeof getNovel>>>;
type GlossaryStats = Awaited<ReturnType<typeof getGlossaryStats>> | undefined;
type CostData = Awaited<ReturnType<typeof getNovelCosts>> | undefined;

export interface NovelHeaderProps {
  novel: Novel;
  novelId: string;
  isAdmin: boolean;
  glossaryStats: GlossaryStats;
  costData: CostData;
  chapters: ChapterRow[];
  chaptersPending: boolean;
  lastReadChapter: ChapterRow | null;
  firstChapter: ChapterRow | null;
  exporting: "txt" | "epub" | null;
  publishingNovel: boolean;
  onPublishNovel: (publishedAt: Date | null) => void;
  onExportTxt: () => void;
  onExportEpub: () => void;
  onDeleteNovel: () => void;
}

export function NovelHeader({
  novel,
  novelId,
  isAdmin,
  glossaryStats,
  costData,
  chapters,
  chaptersPending,
  lastReadChapter,
  firstChapter,
  exporting,
  publishingNovel,
  onPublishNovel,
  onExportTxt,
  onExportEpub,
  onDeleteNovel,
}: NovelHeaderProps) {
  const translatedChapterCount = chaptersPending
    ? 0
    : chapters.filter((chapter) => chapter.status === "translated").length;
  const progressPercent =
    chaptersPending || chapters.length === 0
      ? 0
      : Math.round((translatedChapterCount / chapters.length) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <Button variant="ghost" size="icon" render={<Link to="/" />} aria-label="Go to Library">
          <ArrowLeft className="size-4" />
        </Button>
        {isAdmin && (
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
              {glossaryStats && glossaryStats.total > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] font-mono">
                  {glossaryStats.total}
                </Badge>
              )}
              {glossaryStats && glossaryStats.pending > 0 && (
                <span className="size-2 rounded-full bg-amber-500 animate-pulse ml-0.5" />
              )}
            </Button>
            {novel.sourceLang === "zh" && novel.targetLang === "th" && (
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
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" disabled={exporting !== null} />}
                aria-label="Export novel"
                title="Export novel"
              >
                {exporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                <span className="hidden sm:inline">Export</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={onExportTxt}>
                    <FileText className="size-4" />
                    Novel as .txt
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onExportEpub}>
                    <FileType className="size-4" />
                    Novel as .epub
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              render={<Link to="/novels/$novelId/edit" params={{ novelId }} />}
              aria-label="Edit novel"
              title="Edit novel"
            >
              <Edit className="size-4" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDeleteNovel}
              aria-label="Delete novel"
              title="Delete novel"
            >
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
        <div className="relative aspect-3/4 w-full max-w-50 overflow-hidden rounded-xl border border-border bg-foreground/3 flex items-center justify-center self-start">
          <NovelCover
            novelId={novel.id}
            coverVersion={novel.updatedAt}
            alt={novel.title}
            sizes="200px"
            priority
            className="h-full w-full object-cover"
            fallbackSize={16}
          />
        </div>

        <div className="flex flex-col gap-4 flex-1">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-card-title sm:text-sub md:text-section font-semibold text-foreground tracking-tight">
                {novel.title}
              </h1>
              <Badge
                variant="outline"
                className="uppercase font-semibold text-xs border-foreground/40"
              >
                {novel.sourceLang} → {novel.targetLang}
              </Badge>
            </div>
            {novel.originalTitle && (
              <p className="text-body text-muted-foreground mt-1 font-medium">
                {novel.originalTitle}
              </p>
            )}
            {novel.author && (
              <p className="text-sm text-muted-foreground mt-0.5">By {novel.author}</p>
            )}
          </div>

          {novel.description && (
            <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed whitespace-pre-wrap">
              {novel.description}
            </p>
          )}

          {!chaptersPending && chapters.length > 0 && (
            <div className="pt-2 flex flex-wrap items-center gap-2">
              {lastReadChapter ? (
                <Button
                  size="sm"
                  className="w-full sm:w-auto"
                  render={
                    <Link
                      to="/novels/$novelId/chapters/$chapterId"
                      params={{ novelId, chapterId: lastReadChapter.id }}
                    />
                  }
                >
                  <BookOpen className="size-4" />
                  <span>Continue Reading</span>
                  <span className="text-xs opacity-75 font-normal truncate max-w-50">
                    ({lastReadChapter.translatedTitle ?? lastReadChapter.title})
                  </span>
                </Button>
              ) : firstChapter ? (
                <Button
                  size="sm"
                  className="w-full sm:w-auto"
                  render={
                    <Link
                      to="/novels/$novelId/chapters/$chapterId"
                      params={{ novelId, chapterId: firstChapter.id }}
                    />
                  }
                >
                  <BookOpen className="size-4" />
                  <span>Read First Chapter</span>
                </Button>
              ) : null}

              {lastReadChapter && firstChapter && (
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
                  Read First Chapter
                </Button>
              )}
            </div>
          )}

          <div className="max-w-md pt-2 flex flex-col gap-1.5">
            <div className="flex justify-between text-caption text-muted-foreground">
              <span>Overall Translation Progress</span>
              <span>
                {chaptersPending
                  ? "Loading chapter progress…"
                  : `${progressPercent}% (${translatedChapterCount}/${chapters.length} chapters)`}
              </span>
            </div>
            <Progress value={chaptersPending ? null : progressPercent} className="h-2" />
            {costData &&
              (costData.totals.promptTokens > 0 || costData.totals.completionTokens > 0) && (
                <div className="flex justify-between text-caption text-muted-foreground font-mono">
                  <span>Translation usage</span>
                  <span>
                    {formatTokens(costData.totals.promptTokens)} in /{" "}
                    {formatTokens(costData.totals.completionTokens)} out
                    {costData.totals.cost != null && ` · ${formatCost(costData.totals.cost)}`}
                  </span>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
