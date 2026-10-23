import { memo } from "react";
import { useForm, useStore } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { Check, Edit, History, Play, RotateCw, Square, Terminal, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { TableCell, TableRow } from "@/components/ui/table";
import { ChapterStatusBadge } from "@/components/chapters/table/chapter-status-badge";
import { ChapterPublicationBadge } from "@/components/chapters/table/chapter-publication-badge";
import { publishState } from "@/lib/content/publish/publish";
import type { PublicationBlock } from "@/lib/content/publish/readiness";
import type { TitleEditState } from "@/components/chapters/table/use-chapter-title-edit";
import { PublishMenu } from "@/components/publish-menu";
import { formatNumber } from "@/lib/i18n/format";
import { encodeMessage } from "@/lib/i18n/message-code";
import { cn, formatCost, formatTokens } from "@/lib/utils";
import type { TranslationStartMode } from "@/lib/translation/api/schemas";
import type { ActiveJobState, NovelCostData } from "@/lib/translation/types/api";
import type { ChapterRow } from "@/components/chapters/types";

export type ChapterCost = NovelCostData["costs"][string];

export interface ChapterTableRowProps {
  chapter: ChapterRow;
  novelId: string;
  viewer: "admin" | "guest";
  activeJob: ActiveJobState | undefined;
  readState: "read" | "unread";
  residualScriptCount: number | undefined;
  publicationBlocks: readonly PublicationBlock[] | undefined;
  chapterCost: ChapterCost | undefined;
  selected: boolean;
  translationState: "translating" | "idle";
  titleEdit: TitleEditState | null;

  publishingChapter: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onPublishChapter: (vars: { chapterId: string; publishedAt: Date | null }) => void;
  onCancelTranslate: (jobId: string, chapterId: string) => void;
  onRetryTranslate: (jobId: string, chapterId: string) => void;
  onStartTranslate: (chapterId: string, mode: TranslationStartMode) => void;
  onRequestRetranslate: (chapterId: string) => void;
  onViewLogs: (chapterId: string) => void;
  onViewHistory: (chapterId: string) => void;
  onSaveTitle?: (value: string) => Promise<void>;
  onStartEdit: (chapter: ChapterRow) => void;
  onCancelEdit: () => void;
  onDeleteChapter: (chapterId: string) => void;
}

type ChapterTableRowCellsProps = ChapterTableRowProps;

function AdminSelectionCell({
  chapter,
  viewer,
  selected,
  onToggleSelect,
}: Pick<ChapterTableRowProps, "chapter" | "viewer" | "selected" | "onToggleSelect">) {
  const t = useTranslations("studio");
  if (viewer !== "admin") return null;
  return (
    <TableCell className="w-10">
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onToggleSelect(chapter.id, event.target.checked)}
        aria-label={t("selectChapter", { number: Number(chapter.number) })}
        className="size-4 accent-primary align-middle"
      />
    </TableCell>
  );
}

interface ChapterTitleEditorProps {
  chapter: ChapterRow;
  titleEdit: TitleEditState;
  translationState: ChapterTableRowProps["translationState"];
  onSaveTitle: ((value: string) => Promise<void>) | undefined;
  onCancelEdit: () => void;
}

const translatedTitleSchema = z.object({
  translatedTitle: z.string().max(500, encodeMessage("validation.translatedTitleMax")),
});

function ChapterTitleEditor({
  chapter,
  titleEdit,
  translationState,
  onSaveTitle,
  onCancelEdit,
}: ChapterTitleEditorProps) {
  const t = useTranslations("studio");
  const form = useForm({
    defaultValues: {
      translatedTitle: titleEdit.initialTranslatedTitle,
    },
    validators: {
      onSubmit: translatedTitleSchema,
    },
    onSubmit: async ({ value }) => {
      const parsed = translatedTitleSchema.parse(value);
      await onSaveTitle?.(parsed.translatedTitle);
    },
  });
  const [titleValue, canSubmit, isSubmitting] = useStore(
    form.store,
    (state) => [state.values.translatedTitle, state.canSubmit, state.isSubmitting] as const,
    (previous, next) =>
      previous[0] === next[0] && previous[1] === next[1] && previous[2] === next[2],
  );

  return (
    <form
      noValidate
      className="flex min-w-56 flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <span className="text-caption font-normal text-muted-foreground">
        {t("sourceLabel", { title: chapter.title })}
      </span>
      <form.Field name="translatedTitle">
        {(field) => {
          const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={invalid || undefined} className="gap-1">
              <div className="flex items-center gap-1.5">
                <Input
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelEdit();
                    }
                  }}
                  aria-label={t("translatedTitleField", { number: Number(chapter.number) })}
                  aria-invalid={invalid}
                  maxLength={500}
                  autoFocus
                  disabled={translationState === "translating"}
                  className="h-8"
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("saveTranslatedTitle")}
                  title={t("saveTranslatedTitle")}
                  disabled={
                    titleValue.trim() === titleEdit.initialTranslatedTitle ||
                    !canSubmit ||
                    isSubmitting ||
                    translationState === "translating"
                  }
                >
                  {isSubmitting ? <Spinner /> : <Check className="size-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("cancelTranslatedTitle")}
                  title={t("cancelTranslatedTitle")}
                  onClick={onCancelEdit}
                  disabled={isSubmitting}
                >
                  <X className="size-4 text-muted-foreground" />
                </Button>
              </div>
              {invalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          );
        }}
      </form.Field>
    </form>
  );
}

function ChapterTitleLink({
  chapter,
  novelId,
  readState,
  residualScriptCount,
  publicationBlocks,
}: Pick<
  ChapterTableRowProps,
  "chapter" | "novelId" | "readState" | "residualScriptCount" | "publicationBlocks"
>) {
  const t = useTranslations("studio");
  return (
    <div className="flex items-center gap-2">
      <Link
        to="/{-$locale}/novels/$novelId/chapters/$chapterId"
        params={{ novelId, chapterId: chapter.id }}
        className={cn(
          "text-foreground hover:underline underline-offset-4",
          readState === "read" && "text-muted-foreground font-normal",
        )}
      >
        {chapter.translatedTitle ?? chapter.title}
      </Link>
      {readState === "read" ? (
        <span className="text-caption text-muted-foreground">{t("openedMarker")}</span>
      ) : null}
      {residualScriptCount ? (
        <Badge variant="warningStrong" className="font-mono text-xs">
          {t("residualScriptLetters", { count: residualScriptCount })}
        </Badge>
      ) : null}
      {publicationBlocks && publicationBlocks.length > 0 ? (
        <ChapterPublicationBadge
          blockers={publicationBlocks}
          live={publishState(chapter.publishedAt) === "live"}
        />
      ) : null}
    </div>
  );
}

function ChapterStatusOrProgress({
  chapter,
  activeJob,
  mobile = false,
}: Pick<ChapterTableRowProps, "chapter" | "activeJob"> & { mobile?: boolean }) {
  const t = useTranslations("studio");
  const translating =
    activeJob && (activeJob.status === "running" || activeJob.status === "pending");
  if (!translating) return <ChapterStatusBadge status={chapter.status} />;

  return (
    <div className={cn("flex min-w-28 flex-col gap-1", mobile && "flex-1")}>
      <div className="flex justify-between text-xs text-muted-foreground font-mono">
        <span>{t("translatingProgress")}</span>
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
  const t = useTranslations("studio");
  if (!chapterCost) return null;
  const source =
    chapterCost.source === "current-settings-estimate"
      ? t("costEstimate")
      : chapterCost.source === "unpriced"
        ? t("costUnpriced")
        : "";
  return (
    <div className={cn("font-mono text-muted-foreground", !mobile && "text-caption")}>
      {formatTokens(chapterCost.promptTokens + chapterCost.completionTokens)} tok
      {chapterCost.cost != null ? ` · ${formatCost(chapterCost.cost)}` : null}
      {source ? ` · ${source}` : null}
    </div>
  );
}

function ChapterTitleCell(props: ChapterTableRowProps) {
  const t = useTranslations("studio");
  const locale = useLocale();
  const { chapter, viewer, activeJob, titleEdit, chapterCost } = props;
  return (
    <TableCell className="font-medium">
      {titleEdit ? (
        <ChapterTitleEditor
          key={titleEdit.chapterId}
          chapter={chapter}
          titleEdit={titleEdit}
          translationState={props.translationState}
          onSaveTitle={props.onSaveTitle}
          onCancelEdit={props.onCancelEdit}
        />
      ) : (
        <ChapterTitleLink
          chapter={chapter}
          novelId={props.novelId}
          readState={props.readState}
          residualScriptCount={props.residualScriptCount}
          publicationBlocks={props.publicationBlocks}
        />
      )}
      <div className="sm:hidden mt-1.5 flex flex-col gap-1 text-caption text-muted-foreground">
        <div className="flex items-center gap-2">
          <ChapterStatusOrProgress chapter={chapter} activeJob={activeJob} mobile />
          <span>
            · {formatNumber(chapter.rawCharCount, locale)} {t("chars")}
          </span>
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
  const locale = useLocale();
  return (
    <TableCell className="text-muted-foreground hidden sm:table-cell">
      {formatNumber(chapter.rawCharCount, locale)}
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
  const t = useTranslations("studio");
  if (translationState === "translating" && activeJob) {
    return (
      <Button
        variant="ghostWarning"
        size="icon"
        className="size-8"
        onClick={() => onCancelTranslate(activeJob.jobId, chapter.id)}
        aria-label={t("cancelTranslation")}
        title={t("cancelTranslation")}
      >
        <Square className="size-4" />
      </Button>
    );
  }

  if (chapter.status === "error" || activeJob?.status === "error") {
    return (
      <Button
        variant="ghostDestructive"
        size="icon"
        className="size-8"
        onClick={() => {
          if (activeJob) {
            onRetryTranslate(activeJob.jobId, chapter.id);
          } else if (chapter.hasTranslation) {
            onRequestRetranslate(chapter.id);
          } else {
            onStartTranslate(chapter.id, "missing");
          }
        }}
        aria-label={t("retryTranslation")}
        title={t("retryTranslation")}
      >
        <RotateCw className="size-4" />
      </Button>
    );
  }

  if (chapter.hasTranslation) {
    return (
      <Button
        variant="ghostPrimary"
        size="icon"
        className="size-8"
        onClick={() => onRequestRetranslate(chapter.id)}
        aria-label={t("retranslateChapter")}
        title={t("retranslateChapter")}
      >
        <RotateCw className="size-4" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghostPrimary"
      size="icon"
      className="size-8"
      onClick={() => onStartTranslate(chapter.id, "missing")}
      aria-label={t("translateChapter")}
      title={t("translateChapter")}
    >
      <Play className="size-4" />
    </Button>
  );
}

function AdminActionsCell(props: ChapterTableRowProps) {
  const t = useTranslations("studio");
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
        {/* The trail outlives the text, which is exactly when it matters: a chapter cleared
            by a bulk delete has no translation and no `translated` status, but its versions
            are still the way back. */}
        {chapter.hasTranslation || chapter.status === "translated" || chapter.hasHistory ? (
          <Button
            variant="ghostMuted"
            size="icon"
            className="size-8"
            onClick={() => props.onViewHistory(chapter.id)}
            aria-label={t("historyAction")}
            title={t("historyAction")}
          >
            <History className="size-4" />
          </Button>
        ) : null}
        {activeJob || chapter.status !== "raw" ? (
          <Button
            variant="ghostMuted"
            size="icon"
            className="size-8"
            onClick={() => props.onViewLogs(chapter.id)}
            aria-label={t("viewLogs")}
            title={t("viewLogs")}
          >
            <Terminal className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => (isTitleEditing ? props.onCancelEdit() : props.onStartEdit(chapter))}
          aria-label={isTitleEditing ? t("cancelEdit") : t("editChapter")}
          title={isTitleEditing ? t("cancelEdit") : t("editChapter")}
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
          aria-label={t("deleteChapter")}
        >
          <Trash2 className="size-4 text-destructive-text" />
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
  publicationBlocks,
  chapterCost,
  selected,
  translationState,
  titleEdit,
  publishingChapter,
  onToggleSelect,
  onPublishChapter,
  onCancelTranslate,
  onRetryTranslate,
  onStartTranslate,
  onRequestRetranslate,
  onViewLogs,
  onViewHistory,
  onSaveTitle,
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
      publicationBlocks={publicationBlocks}
      chapterCost={chapterCost}
      selected={selected}
      translationState={translationState}
      titleEdit={titleEdit}
      publishingChapter={publishingChapter}
      onToggleSelect={onToggleSelect}
      onPublishChapter={onPublishChapter}
      onCancelTranslate={onCancelTranslate}
      onRetryTranslate={onRetryTranslate}
      onStartTranslate={onStartTranslate}
      onRequestRetranslate={onRequestRetranslate}
      onViewLogs={onViewLogs}
      onViewHistory={onViewHistory}
      onSaveTitle={isTitleEditing ? onSaveTitle : undefined}
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
