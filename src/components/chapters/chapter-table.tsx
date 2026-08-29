import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  GripVertical,
  Check,
  Edit,
  Play,
  RotateCw,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
  type SortableCommitMeta,
} from "@/components/ui/sortable";
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
import type { TitleEditState } from "@/components/chapters/use-chapter-title-edit";
import type { ChapterRow } from "./types";
import { PublishMenu } from "@/components/publish-menu";
import { cn, formatCost, formatTokens } from "@/lib/utils";
import type { getNovelCosts } from "@/lib/translation/translation.functions";
import type { ActiveJobState } from "@/lib/translation/translation.types";

type OptimisticChapterOrder = {
  version: string;
  value: ChapterRow[];
};

function getChapterVersion(chapters: ChapterRow[]): string {
  return chapters
    .map((chapter) =>
      [
        chapter.id,
        chapter.number,
        chapter.title,
        chapter.translatedTitle ?? "",
        chapter.status,
        chapter.rawCharCount,
        chapter.publishedAt ?? "",
        chapter.editedAt ?? "",
      ].join(":"),
    )
    .join("|");
}
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
  titleEdit: TitleEditState | null;
  editErrors: Record<string, string>;
  onSaveTitle: () => void;
  savingTitle: boolean;
  onTitleChange: (value: string) => void;
  onStartEdit: (chapter: ChapterRow) => void;
  onCancelEdit: () => void;
  onDeleteChapter: (chapterId: string) => void;
  reorderingChapters: boolean;
  onReorderChapters: (chapterIds: string[]) => Promise<unknown>;
  refetchChapters: () => Promise<unknown>;
}

function assignNumberSlots(next: ChapterRow[], previous: ChapterRow[]): ChapterRow[] {
  return next.map((chapter, index) => ({
    ...chapter,
    number: previous[index]?.number ?? chapter.number,
  }));
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
  titleEdit,
  editErrors,
  savingTitle,
  onTitleChange,
  onSaveTitle,
  onStartEdit,
  onCancelEdit,
  onDeleteChapter,
  reorderingChapters,
  onReorderChapters,
  refetchChapters,
}: ChapterTableProps) {
  const chapterVersion = useMemo(() => getChapterVersion(chapters), [chapters]);
  const [optimisticOrder, setOptimisticOrder] = useState<OptimisticChapterOrder | null>(null);
  const orderedChapters =
    optimisticOrder?.version === chapterVersion ? optimisticOrder.value : chapters;
  const dragSlotsRef = useRef<string[]>([]);

  const hasActiveTranslation = orderedChapters.some((chapter) =>
    isTranslating(chapter.id, chapter.status),
  );
  const sortingDisabled =
    !isAdmin || reorderingChapters || editingChapterId !== null || hasActiveTranslation;

  const handleDragStart = useCallback(() => {
    dragSlotsRef.current = orderedChapters.map((chapter) => chapter.number);
  }, [orderedChapters]);

  const handleValueChange = useCallback(
    (nextValue: ChapterRow[]) => {
      const slots =
        dragSlotsRef.current.length === nextValue.length
          ? dragSlotsRef.current
          : orderedChapters.map((chapter) => chapter.number);
      const nextOrder = nextValue.map((chapter, index) => ({
        ...chapter,
        number: slots[index] ?? chapter.number,
      }));
      setOptimisticOrder({ version: chapterVersion, value: nextOrder });
    },
    [chapterVersion, orderedChapters],
  );

  const handleValueCommit = useCallback(
    (nextValue: ChapterRow[], meta: SortableCommitMeta<ChapterRow>) => {
      const optimisticValue = assignNumberSlots(nextValue, meta.previousValue);
      setOptimisticOrder({ version: chapterVersion, value: optimisticValue });
      dragSlotsRef.current = [];

      const persist = async () => {
        try {
          await onReorderChapters(optimisticValue.map((chapter) => chapter.id));
        } catch (error) {
          setOptimisticOrder({ version: chapterVersion, value: meta.previousValue });
          await refetchChapters();
          toast.error(
            error instanceof Error
              ? error.message
              : "Chapter order could not be saved. Refresh and try again.",
          );
        }
      };
      void persist();
    },
    [chapterVersion, onReorderChapters, refetchChapters],
  );

  const renderChapterRow = (chapter: ChapterRow) => {
    const activeJob = activeJobs.get(chapter.id);
    const isRowTranslating = isTranslating(chapter.id, chapter.status);
    const isRead = readChapterIds.includes(chapter.id);
    const residualCount = residualHanziMap.get(chapter.id);
    const displayTitle = chapter.translatedTitle ?? chapter.title;
    const isTitleEditing = titleEdit?.chapterId === chapter.id;
    const normalizedTitle = titleEdit?.translatedTitle.trim() ?? "";
    const titleChanged = isTitleEditing && normalizedTitle !== titleEdit?.initialTranslatedTitle;
    const titleValid = normalizedTitle.length <= 500;

    const row = (
      <TableRow
        key={chapter.id}
        data-editing={editingChapterId === chapter.id ? "true" : undefined}
        className="data-[editing=true]:bg-muted/50"
      >
        {isAdmin && (
          <TableCell className="w-10">
            <SortableItemHandle
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label={`Reorder chapter ${Number(chapter.number)}: ${displayTitle}`}
              title="Reorder chapter"
              disabled={sortingDisabled}
            >
              <GripVertical className="size-4 text-muted-foreground" />
            </SortableItemHandle>
          </TableCell>
        )}
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
          {isTitleEditing ? (
            <form
              className="flex min-w-56 flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (titleChanged && titleValid && !savingTitle && !isRowTranslating) {
                  onSaveTitle();
                }
              }}
            >
              <span className="text-caption font-normal text-muted-foreground">
                Source: {chapter.title}
              </span>
              <div className="flex items-center gap-1.5">
                <Input
                  value={titleEdit?.translatedTitle ?? ""}
                  onChange={(event) => onTitleChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelEdit();
                    }
                  }}
                  aria-label={`Translated title for chapter ${Number(chapter.number)}`}
                  aria-invalid={editErrors.translatedTitle ? true : undefined}
                  maxLength={500}
                  autoFocus
                  disabled={savingTitle || isRowTranslating}
                  className="h-8"
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Save translated title"
                  title="Save translated title"
                  disabled={!titleChanged || !titleValid || savingTitle || isRowTranslating}
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cancel translated title edit"
                  title="Cancel translated title edit"
                  onClick={onCancelEdit}
                  disabled={savingTitle}
                >
                  <X className="size-4 text-muted-foreground" />
                </Button>
              </div>
              {editErrors.translatedTitle && (
                <span className="text-caption font-normal text-destructive">
                  {editErrors.translatedTitle}
                </span>
              )}
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/novels/$novelId/chapters/$chapterId"
                params={{ novelId, chapterId: chapter.id }}
                className={cn(
                  "text-foreground hover:underline underline-offset-4",
                  isRead && "text-muted-foreground font-normal",
                )}
              >
                {displayTitle}
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
          )}
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
                title={editingChapterId === chapter.id ? "Cancel edit" : "Edit chapter"}
                disabled={editingChapterId !== chapter.id && isRowTranslating}
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

    return isAdmin ? (
      <SortableItem key={chapter.id} value={chapter.id} disabled={sortingDisabled} render={row}>
        {row.props.children}
      </SortableItem>
    ) : (
      row
    );
  };

  const rows = orderedChapters.map(renderChapterRow);
  const tableBody = isAdmin ? (
    <Sortable<ChapterRow>
      value={orderedChapters}
      onValueChange={handleValueChange}
      onValueCommit={handleValueCommit}
      getItemValue={(chapter) => chapter.id}
      onDragStart={handleDragStart}
      render={<TableBody />}
      renderOverlay={(value) => {
        const chapter = orderedChapters.find((item) => item.id === String(value));
        return chapter ? (
          <div className="flex min-w-56 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-lg">
            <span className="font-mono text-muted-foreground">{Number(chapter.number)}</span>
            <span className="truncate font-medium">{chapter.translatedTitle ?? chapter.title}</span>
          </div>
        ) : null;
      }}
    >
      {rows}
    </Sortable>
  ) : (
    <TableBody>{rows}</TableBody>
  );

  return (
    <div>
      {isAdmin && reorderingChapters && (
        <p className="px-3 py-2 text-caption text-muted-foreground" aria-live="polite">
          Saving chapter order…
        </p>
      )}
      <Table>
        {isAdmin && (
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" aria-hidden="true" />
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
        {tableBody}
      </Table>
    </div>
  );
}
