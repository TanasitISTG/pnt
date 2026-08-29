import { memo } from "react";
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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SortableItem, SortableItemHandle } from "@/components/ui/sortable";
import { Progress } from "@/components/ui/progress";
import { TableCell, TableRow } from "@/components/ui/table";
import { ChapterStatusBadge } from "@/components/chapters/chapter-status-badge";
import type { TitleEditState } from "@/components/chapters/use-chapter-title-edit";
import { PublishMenu } from "@/components/publish-menu";
import { cn, formatCost, formatTokens } from "@/lib/utils";
import type { ActiveJobState, NovelCostData } from "@/lib/translation/translation.types";
import type { ChapterRow } from "./types";

export type ChapterCost = NovelCostData["costs"][string];

export interface ChapterTableRowProps {
  chapter: ChapterRow;
  novelId: string;
  isAdmin: boolean;
  activeJob: ActiveJobState | undefined;
  isRead: boolean;
  residualCount: number | undefined;
  chapterCost: ChapterCost | undefined;
  selected: boolean;
  isRowTranslating: boolean;
  isTitleEditing: boolean;
  titleEdit: TitleEditState | null;
  editError: string | undefined;
  savingTitle: boolean;
  sortingDisabled: boolean;
  publishingChapter: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onPublishChapter: (vars: { chapterId: string; publishedAt: Date | null }) => void;
  onCancelTranslate: (jobId: string, chapterId: string) => void;
  onRetryTranslate: (jobId: string, chapterId: string) => void;
  onStartTranslate: (chapterId: string) => void;
  onRequestRetranslate: (chapterId: string) => void;
  onViewLogs: (chapterId: string) => void;
  onSaveTitle?: () => void;
  onTitleChange: (value: string) => void;
  onStartEdit: (chapter: ChapterRow) => void;
  onCancelEdit: () => void;
  onDeleteChapter: (chapterId: string) => void;
}

interface ChapterTableDragHandleProps {
  chapter: ChapterRow;
  displayTitle: string;
}

const ChapterTableDragHandle = memo(function ChapterTableDragHandle({
  chapter,
  displayTitle,
}: ChapterTableDragHandleProps) {
  return (
    <TableCell className="w-10">
      <SortableItemHandle
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={`Reorder chapter ${Number(chapter.number)}: ${displayTitle}`}
        title="Reorder chapter"
      >
        <GripVertical className="size-4 text-muted-foreground" />
      </SortableItemHandle>
    </TableCell>
  );
});

type ChapterTableRowCellsProps = Omit<ChapterTableRowProps, "sortingDisabled">;

const ChapterTableRowCells = memo(function ChapterTableRowCells({
  chapter,
  novelId,
  isAdmin,
  activeJob,
  isRead,
  residualCount,
  chapterCost,
  selected,
  isRowTranslating,
  isTitleEditing,
  titleEdit,
  editError,
  savingTitle,
  publishingChapter,
  onToggleSelect,
  onPublishChapter,
  onCancelTranslate,
  onRetryTranslate,
  onStartTranslate,
  onRequestRetranslate,
  onViewLogs,
  onSaveTitle,
  onTitleChange,
  onStartEdit,
  onCancelEdit,
  onDeleteChapter,
}: ChapterTableRowCellsProps) {
  const displayTitle = chapter.translatedTitle ?? chapter.title;
  const normalizedTitle = titleEdit?.translatedTitle.trim() ?? "";
  const titleChanged = isTitleEditing && normalizedTitle !== titleEdit?.initialTranslatedTitle;
  const titleValid = normalizedTitle.length <= 500;

  return (
    <>
      {isAdmin && (
        <TableCell className="w-10">
          <input
            type="checkbox"
            checked={selected}
            disabled={isRowTranslating}
            onChange={(event) => onToggleSelect(chapter.id, event.target.checked)}
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
                onSaveTitle?.();
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
                aria-invalid={editError ? true : undefined}
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
            {editError && (
              <span className="text-caption font-normal text-destructive">{editError}</span>
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
          {isAdmin && chapterCost && (
            <div className="font-mono text-muted-foreground">
              {formatTokens(chapterCost.promptTokens + chapterCost.completionTokens)} tok
              {chapterCost.cost != null && ` · ${formatCost(chapterCost.cost)}`}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground hidden sm:table-cell">
        {chapter.rawCharCount.toLocaleString()}
        {isAdmin && chapterCost && (
          <div className="text-caption font-mono text-muted-foreground">
            {formatTokens(chapterCost.promptTokens + chapterCost.completionTokens)} tok
            {chapterCost.cost != null && ` · ${formatCost(chapterCost.cost)}`}
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
              onClick={() => (isTitleEditing ? onCancelEdit() : onStartEdit(chapter))}
              aria-label={isTitleEditing ? "Cancel edit" : "Edit chapter"}
              title={isTitleEditing ? "Cancel edit" : "Edit chapter"}
              disabled={!isTitleEditing && isRowTranslating}
            >
              {isTitleEditing ? (
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
    </>
  );
});

export const ChapterTableRow = memo(function ChapterTableRow({
  chapter,
  novelId,
  isAdmin,
  activeJob,
  isRead,
  residualCount,
  chapterCost,
  selected,
  isRowTranslating,
  isTitleEditing,
  titleEdit,
  editError,
  savingTitle,
  sortingDisabled,
  publishingChapter,
  onToggleSelect,
  onPublishChapter,
  onCancelTranslate,
  onRetryTranslate,
  onStartTranslate,
  onRequestRetranslate,
  onViewLogs,
  onSaveTitle,
  onTitleChange,
  onStartEdit,
  onCancelEdit,
  onDeleteChapter,
}: ChapterTableRowProps) {
  const displayTitle = chapter.translatedTitle ?? chapter.title;
  const cells = (
    <ChapterTableRowCells
      chapter={chapter}
      novelId={novelId}
      isAdmin={isAdmin}
      activeJob={activeJob}
      isRead={isRead}
      residualCount={residualCount}
      chapterCost={chapterCost}
      selected={selected}
      isRowTranslating={isRowTranslating}
      isTitleEditing={isTitleEditing}
      titleEdit={titleEdit}
      editError={editError}
      savingTitle={savingTitle}
      publishingChapter={publishingChapter}
      onToggleSelect={onToggleSelect}
      onPublishChapter={onPublishChapter}
      onCancelTranslate={onCancelTranslate}
      onRetryTranslate={onRetryTranslate}
      onStartTranslate={onStartTranslate}
      onRequestRetranslate={onRequestRetranslate}
      onViewLogs={onViewLogs}
      onSaveTitle={isTitleEditing ? onSaveTitle : undefined}
      onTitleChange={onTitleChange}
      onStartEdit={onStartEdit}
      onCancelEdit={onCancelEdit}
      onDeleteChapter={onDeleteChapter}
    />
  );
  const row = (
    <TableRow
      key={chapter.id}
      data-editing={isTitleEditing ? "true" : undefined}
      className="data-[editing=true]:bg-muted/50"
    >
      {isAdmin && <ChapterTableDragHandle chapter={chapter} displayTitle={displayTitle} />}
      {cells}
    </TableRow>
  );

  return isAdmin ? (
    <SortableItem key={chapter.id} value={chapter.id} disabled={sortingDisabled} render={row}>
      {row.props.children}
    </SortableItem>
  ) : (
    row
  );
});
