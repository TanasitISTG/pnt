import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Edit, Play, RotateCw, Square, Terminal, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { TableCell, TableRow } from "@/components/ui/table";
import { ChapterStatusBadge } from "@/components/chapters/chapter-status-badge";
import type { TitleEditState } from "@/components/chapters/use-chapter-title-edit";
import { PublishMenu } from "@/components/publish-menu";
import { cn, formatCost, formatTokens } from "@/lib/utils";
import type { ActiveJobState, NovelCostData } from "@/lib/translation/types/api";
import type { ChapterRow } from "./types";

export type ChapterCost = NovelCostData["costs"][string];

export interface ChapterTableRowProps {
  chapter: ChapterRow;
  novelId: string;
  viewer: "admin" | "guest";
  activeJob: ActiveJobState | undefined;
  readState: "read" | "unread";
  residualScriptCount: number | undefined;
  chapterCost: ChapterCost | undefined;
  selected: boolean;
  translationState: "translating" | "idle";
  titleEdit: TitleEditState | null;
  editError: string | undefined;
  savingTitle: boolean;
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

type ChapterTableRowCellsProps = ChapterTableRowProps;

function AdminSelectionCell({
  chapter,
  viewer,
  selected,
  translationState,
  onToggleSelect,
}: Pick<
  ChapterTableRowProps,
  "chapter" | "viewer" | "selected" | "translationState" | "onToggleSelect"
>) {
  if (viewer !== "admin") return null;
  return (
    <TableCell className="w-10">
      <input
        type="checkbox"
        checked={selected}
        disabled={translationState === "translating"}
        onChange={(event) => onToggleSelect(chapter.id, event.target.checked)}
        aria-label={`Select chapter ${Number(chapter.number)}`}
        className="size-4 accent-primary align-middle"
      />
    </TableCell>
  );
}

interface ChapterTitleEditorProps {
  chapter: ChapterRow;
  titleEdit: TitleEditState;
  editError: string | undefined;
  savingTitle: boolean;
  translationState: ChapterTableRowProps["translationState"];
  onSaveTitle: (() => void) | undefined;
  onTitleChange: (value: string) => void;
  onCancelEdit: () => void;
}

function ChapterTitleEditor({
  chapter,
  titleEdit,
  editError,
  savingTitle,
  translationState,
  onSaveTitle,
  onTitleChange,
  onCancelEdit,
}: ChapterTitleEditorProps) {
  const normalizedTitle = titleEdit.translatedTitle.trim();
  const titleChanged = normalizedTitle !== titleEdit.initialTranslatedTitle;
  const titleValid = normalizedTitle.length <= 500;
  const saveDisabled =
    !titleChanged || !titleValid || savingTitle || translationState === "translating";

  return (
    <form
      className="flex min-w-56 flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saveDisabled) onSaveTitle?.();
      }}
    >
      <span className="text-caption font-normal text-muted-foreground">
        Source: {chapter.title}
      </span>
      <div className="flex items-center gap-1.5">
        <Input
          value={titleEdit.translatedTitle}
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
          disabled={savingTitle || translationState === "translating"}
          className="h-8"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          aria-label="Save translated title"
          title="Save translated title"
          disabled={saveDisabled}
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
      {editError ? (
        <span className="text-caption font-normal text-destructive">{editError}</span>
      ) : null}
    </form>
  );
}

function ChapterTitleLink({
  chapter,
  novelId,
  readState,
  residualScriptCount,
}: Pick<ChapterTableRowProps, "chapter" | "novelId" | "readState" | "residualScriptCount">) {
  return (
    <div className="flex items-center gap-2">
      <Link
        to="/novels/$novelId/chapters/$chapterId"
        params={{ novelId, chapterId: chapter.id }}
        className={cn(
          "text-foreground hover:underline underline-offset-4",
          readState === "read" && "text-muted-foreground font-normal",
        )}
      >
        {chapter.translatedTitle ?? chapter.title}
      </Link>
      {residualScriptCount ? (
        <Badge
          variant="outline"
          className="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-xs"
        >
          {residualScriptCount} foreign-script letters
        </Badge>
      ) : null}
    </div>
  );
}

function ChapterStatusOrProgress({
  chapter,
  activeJob,
  mobile = false,
}: Pick<ChapterTableRowProps, "chapter" | "activeJob"> & { mobile?: boolean }) {
  const translating =
    activeJob && (activeJob.status === "running" || activeJob.status === "pending");
  if (!translating) return <ChapterStatusBadge status={chapter.status} />;

  return (
    <div className={cn("flex min-w-28 flex-col gap-1", mobile && "flex-1")}>
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
  );
}

function ChapterCostSummary({
  chapterCost,
  mobile = false,
}: {
  chapterCost: ChapterCost | undefined;
  mobile?: boolean;
}) {
  if (!chapterCost) return null;
  return (
    <div className={cn("font-mono text-muted-foreground", !mobile && "text-caption")}>
      {formatTokens(chapterCost.promptTokens + chapterCost.completionTokens)} tok
      {chapterCost.cost != null ? ` · ${formatCost(chapterCost.cost)}` : null}
    </div>
  );
}

function ChapterTitleCell(props: ChapterTableRowProps) {
  const { chapter, viewer, activeJob, titleEdit, chapterCost } = props;
  return (
    <TableCell className="font-medium">
      {titleEdit ? (
        <ChapterTitleEditor
          chapter={chapter}
          titleEdit={titleEdit}
          editError={props.editError}
          savingTitle={props.savingTitle}
          translationState={props.translationState}
          onSaveTitle={props.onSaveTitle}
          onTitleChange={props.onTitleChange}
          onCancelEdit={props.onCancelEdit}
        />
      ) : (
        <ChapterTitleLink
          chapter={chapter}
          novelId={props.novelId}
          readState={props.readState}
          residualScriptCount={props.residualScriptCount}
        />
      )}
      <div className="sm:hidden mt-1.5 flex flex-col gap-1 text-caption text-muted-foreground">
        <div className="flex items-center gap-2">
          <ChapterStatusOrProgress chapter={chapter} activeJob={activeJob} mobile />
          <span>· {chapter.rawCharCount.toLocaleString()} chars</span>
        </div>
        {viewer === "admin" ? <ChapterCostSummary chapterCost={chapterCost} mobile /> : null}
      </div>
    </TableCell>
  );
}

function ChapterCharacterCountCell({
  chapter,
  viewer,
  chapterCost,
}: Pick<ChapterTableRowProps, "chapter" | "viewer" | "chapterCost">) {
  return (
    <TableCell className="text-muted-foreground hidden sm:table-cell">
      {chapter.rawCharCount.toLocaleString()}
      {viewer === "admin" ? <ChapterCostSummary chapterCost={chapterCost} /> : null}
    </TableCell>
  );
}

function TranslationActionButton({
  chapter,
  activeJob,
  translationState,
  onCancelTranslate,
  onRetryTranslate,
  onStartTranslate,
  onRequestRetranslate,
}: Pick<
  ChapterTableRowProps,
  | "chapter"
  | "activeJob"
  | "translationState"
  | "onCancelTranslate"
  | "onRetryTranslate"
  | "onStartTranslate"
  | "onRequestRetranslate"
>) {
  if (translationState === "translating" && activeJob) {
    return (
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
    );
  }

  if (chapter.status === "error" || activeJob?.status === "error") {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:text-destructive"
        onClick={() =>
          activeJob ? onRetryTranslate(activeJob.jobId, chapter.id) : onStartTranslate(chapter.id)
        }
        aria-label="Retry translation"
        title="Retry translation"
      >
        <RotateCw className="size-4" />
      </Button>
    );
  }

  const label = chapter.status === "translated" ? "Re-translate chapter" : "Translate chapter";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-primary hover:text-primary"
      onClick={() =>
        chapter.editedAt ? onRequestRetranslate(chapter.id) : onStartTranslate(chapter.id)
      }
      aria-label={label}
      title={label}
    >
      <Play className="size-4" />
    </Button>
  );
}

function AdminActionsCell(props: ChapterTableRowProps) {
  const { chapter, viewer, activeJob, titleEdit } = props;
  if (viewer !== "admin") return null;
  const isTitleEditing = titleEdit !== null;

  return (
    <TableCell className="text-right">
      <div className="flex justify-end items-center gap-1">
        <PublishMenu
          publishedAt={chapter.publishedAt}
          pending={props.publishingChapter}
          onChange={(publishedAt) => props.onPublishChapter({ chapterId: chapter.id, publishedAt })}
        />
        <TranslationActionButton
          chapter={chapter}
          activeJob={activeJob}
          translationState={props.translationState}
          onCancelTranslate={props.onCancelTranslate}
          onRetryTranslate={props.onRetryTranslate}
          onStartTranslate={props.onStartTranslate}
          onRequestRetranslate={props.onRequestRetranslate}
        />
        {activeJob || chapter.status !== "raw" ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => props.onViewLogs(chapter.id)}
            aria-label="View translation logs"
            title="View translation logs"
          >
            <Terminal className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => (isTitleEditing ? props.onCancelEdit() : props.onStartEdit(chapter))}
          aria-label={isTitleEditing ? "Cancel edit" : "Edit chapter"}
          title={isTitleEditing ? "Cancel edit" : "Edit chapter"}
          disabled={!isTitleEditing && props.translationState === "translating"}
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
          onClick={() => props.onDeleteChapter(chapter.id)}
          aria-label="Delete chapter"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>
    </TableCell>
  );
}

const ChapterTableRowCells = memo(function ChapterTableRowCells(props: ChapterTableRowCellsProps) {
  const { chapter, activeJob } = props;
  return (
    <>
      <AdminSelectionCell
        chapter={chapter}
        viewer={props.viewer}
        selected={props.selected}
        translationState={props.translationState}
        onToggleSelect={props.onToggleSelect}
      />
      <TableCell className="font-medium">{Number(chapter.number)}</TableCell>
      <ChapterTitleCell {...props} />
      <ChapterCharacterCountCell
        chapter={chapter}
        viewer={props.viewer}
        chapterCost={props.chapterCost}
      />
      <TableCell className="hidden sm:table-cell">
        <ChapterStatusOrProgress chapter={chapter} activeJob={activeJob} />
      </TableCell>
      <AdminActionsCell {...props} />
    </>
  );
});

export const ChapterTableRow = memo(function ChapterTableRow({
  chapter,
  novelId,
  viewer,
  activeJob,
  readState,
  residualScriptCount,
  chapterCost,
  selected,
  translationState,
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
}: ChapterTableRowProps) {
  const isTitleEditing = titleEdit !== null;
  const cells = (
    <ChapterTableRowCells
      chapter={chapter}
      novelId={novelId}
      viewer={viewer}
      activeJob={activeJob}
      readState={readState}
      residualScriptCount={residualScriptCount}
      chapterCost={chapterCost}
      selected={selected}
      translationState={translationState}
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
      {cells}
    </TableRow>
  );

  return row;
});
