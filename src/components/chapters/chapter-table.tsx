import { Link } from "@tanstack/react-router";
import { Edit, Play, RotateCw, Square, Terminal, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChapterStatusBadge } from "@/components/chapters/chapter-status-badge";
import type { ChapterRow } from "./types";
import { PublishMenu } from "@/components/publish-menu";
import { cn, formatCost, formatTokens } from "@/lib/utils";
import type { getNovelCosts } from "@/lib/translation/translation.functions";
import type { ActiveJobState } from "@/lib/translation/translation.types";

type CostData = Awaited<ReturnType<typeof getNovelCosts>> | undefined;

export interface ChapterTableProps {
  chapters: ChapterRow[];
  novelId: string;
  isAdmin: boolean;
  activeJobs: Map<string, ActiveJobState>;
  readChapterIds: string[];
  residualHanziMap: Map<string, number>;
  costData: CostData;
  selectedIds: Set<string>;
  allSelected: boolean;
  isTranslating: (chapterId: string, status: string) => boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  publishingChapter: boolean;
  onPublishChapter: (vars: { chapterId: string; publishedAt: Date | null }) => void;
  onCancelTranslate: (jobId: string, chapterId: string) => void;
  onRetryTranslate: (jobId: string, chapterId: string) => void;
  onStartTranslate: (chapterId: string) => void;
  onRequestRetranslate: (chapterId: string) => void;
  onViewLogs: (chapterId: string) => void;
  editingChapterId: string | null;
  onStartEdit: (chapter: ChapterRow) => void;
  onCancelEdit: () => void;
  onDeleteChapter: (chapterId: string) => void;
}

export function ChapterTable({
  chapters,
  novelId,
  isAdmin,
  activeJobs,
  readChapterIds,
  residualHanziMap,
  costData,
  selectedIds,
  allSelected,
  isTranslating,
  onToggleSelect,
  onToggleSelectAll,
  publishingChapter,
  onPublishChapter,
  onCancelTranslate,
  onRetryTranslate,
  onStartTranslate,
  onRequestRetranslate,
  onViewLogs,
  editingChapterId,
  onStartEdit,
  onCancelEdit,
  onDeleteChapter,
}: ChapterTableProps) {
  const renderChapterRow = (chapter: ChapterRow) => {
    const activeJob = activeJobs.get(chapter.id);
    const isRowTranslating = isTranslating(chapter.id, chapter.status);
    const isRead = readChapterIds.includes(chapter.id);
    const residualCount = residualHanziMap.get(chapter.id);

    return (
      <TableRow
        key={chapter.id}
        data-editing={editingChapterId === chapter.id ? "true" : undefined}
        className="data-[editing=true]:bg-muted/50"
      >
        {isAdmin && (
          <TableCell className="w-10">
            <input
              type="checkbox"
              checked={selectedIds.has(chapter.id)}
              disabled={isRowTranslating}
              onChange={(e) => onToggleSelect(chapter.id, e.target.checked)}
              aria-label={`Select chapter ${Number(chapter.number)}`}
              className="size-4 accent-primary align-middle"
            />
          </TableCell>
        )}
        <TableCell className="font-medium">{Number(chapter.number)}</TableCell>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            <Link
              to="/novels/$novelId/chapters/$chapterId"
              params={{ novelId, chapterId: chapter.id }}
              className={cn(
                "text-foreground hover:underline underline-offset-4",
                isRead && "text-muted-foreground font-normal",
              )}
            >
              {chapter.translatedTitle ?? chapter.title}
            </Link>
            {residualCount ? (
              <Badge
                variant="outline"
                className="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-xs"
              >
                {residualCount} hanzi
              </Badge>
            ) : null}
          </div>
          <div className="sm:hidden mt-1.5 flex flex-col gap-1 text-caption text-muted-foreground">
            <div className="flex items-center gap-2">
              {activeJob && (activeJob.status === "running" || activeJob.status === "pending") ? (
                <div className="flex flex-col gap-1 min-w-28 flex-1">
                  <div className="flex justify-between text-xs text-muted-foreground font-mono">
                    <span>Translating...</span>
                    <span>
                      {activeJob.doneChunks}/{activeJob.totalChunks}
                    </span>
                  </div>
                  <Progress
                    value={
                      activeJob.totalChunks > 0
                        ? Math.round((activeJob.doneChunks / activeJob.totalChunks) * 100)
                        : 0
                    }
                    className="h-1.5"
                  />
                </div>
              ) : (
                <ChapterStatusBadge status={chapter.status} />
              )}
              <span>· {chapter.rawCharCount.toLocaleString()} chars</span>
            </div>
            {isAdmin && costData?.costs[chapter.id] && (
              <div className="font-mono text-muted-foreground">
                {formatTokens(
                  costData.costs[chapter.id].promptTokens +
                    costData.costs[chapter.id].completionTokens,
                )}{" "}
                tok
                {costData.costs[chapter.id].cost != null &&
                  ` · ${formatCost(costData.costs[chapter.id].cost!)}`}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground hidden sm:table-cell">
          {chapter.rawCharCount.toLocaleString()}
          {isAdmin && costData?.costs[chapter.id] && (
            <div className="text-caption font-mono text-muted-foreground">
              {formatTokens(
                costData.costs[chapter.id].promptTokens +
                  costData.costs[chapter.id].completionTokens,
              )}{" "}
              tok
              {costData.costs[chapter.id].cost != null &&
                ` · ${formatCost(costData.costs[chapter.id].cost!)}`}
            </div>
          )}
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          {activeJob && (activeJob.status === "running" || activeJob.status === "pending") ? (
            <div className="flex flex-col gap-1 min-w-28">
              <div className="flex justify-between text-xs text-muted-foreground font-mono">
                <span>Translating...</span>
                <span>
                  {activeJob.doneChunks}/{activeJob.totalChunks}
                </span>
              </div>
              <Progress
                value={
                  activeJob.totalChunks > 0
                    ? Math.round((activeJob.doneChunks / activeJob.totalChunks) * 100)
                    : 0
                }
                className="h-1.5"
              />
            </div>
          ) : (
            <ChapterStatusBadge status={chapter.status} />
          )}
        </TableCell>
        {isAdmin && (
          <TableCell className="text-right">
            <div className="flex justify-end items-center gap-1">
              <PublishMenu
                publishedAt={chapter.publishedAt}
                pending={publishingChapter}
                onChange={(publishedAt) => onPublishChapter({ chapterId: chapter.id, publishedAt })}
              />
              {isRowTranslating && activeJob ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-amber-500 hover:text-amber-600"
                  onClick={() => onCancelTranslate(activeJob.jobId, chapter.id)}
                  aria-label="Cancel translation"
                  title="Cancel translation"
                >
                  <Square className="size-4" />
                </Button>
              ) : chapter.status === "error" || activeJob?.status === "error" ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive hover:text-destructive"
                  onClick={() =>
                    activeJob
                      ? onRetryTranslate(activeJob.jobId, chapter.id)
                      : onStartTranslate(chapter.id)
                  }
                  aria-label="Retry translation"
                  title="Retry translation"
                >
                  <RotateCw className="size-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-primary hover:text-primary"
                  onClick={() => {
                    if (chapter.editedAt) {
                      onRequestRetranslate(chapter.id);
                    } else {
                      onStartTranslate(chapter.id);
                    }
                  }}
                  aria-label={
                    chapter.status === "translated" ? "Re-translate chapter" : "Translate chapter"
                  }
                  title={
                    chapter.status === "translated" ? "Re-translate chapter" : "Translate chapter"
                  }
                >
                  <Play className="size-4" />
                </Button>
              )}
              {(activeJob || chapter.status !== "raw") && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={() => onViewLogs(chapter.id)}
                  aria-label="View translation logs"
                  title="View translation logs"
                >
                  <Terminal className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() =>
                  editingChapterId === chapter.id ? onCancelEdit() : onStartEdit(chapter)
                }
                aria-label={editingChapterId === chapter.id ? "Cancel edit" : "Edit chapter"}
              >
                {editingChapterId === chapter.id ? (
                  <X className="size-4 text-muted-foreground" />
                ) : (
                  <Edit className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => onDeleteChapter(chapter.id)}
                aria-label="Delete chapter"
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>
    );
  };

  return (
    <Table>
      {isAdmin && (
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
                aria-label="Select all chapters"
                className="size-4 accent-primary align-middle"
              />
            </TableHead>
            <TableHead className="w-16">#</TableHead>
            <TableHead>Title</TableHead>
            <TableHead className="w-32 hidden sm:table-cell">Chars</TableHead>
            <TableHead className="w-32 hidden sm:table-cell">Status</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
      )}
      <TableBody>{chapters.map(renderChapterRow)}</TableBody>
    </Table>
  );
}
