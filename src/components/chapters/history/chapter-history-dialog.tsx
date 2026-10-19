import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "use-intl";

import type { ChapterRow } from "@/components/chapters/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { chapterQueryOptions } from "@/lib/content/chapter/chapter.query";
import {
  chapterHistoryQueryOptions,
  chapterVersionQueryOptions,
} from "@/lib/content/chapter/chapter-history.query";
import { restoreChapterTranslationVersion } from "@/lib/content/chapter/chapter-history.functions";
import { diffChapterTranslations } from "@/lib/content/chapter/translation-diff";
import { splitParagraphs } from "@/lib/translation/text/paragraphs";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";
import { translateServerError } from "@/lib/i18n/server-error";

export interface ChapterHistoryDialogProps {
  /** The chapter to inspect; `null` is the dialog's closed state. */
  chapter: ChapterRow | null;
  novelId: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * The translation history of one chapter, and the way back from a bad generation.
 *
 * The list is metadata; a version's body is fetched only when it is selected, because the
 * whole point of the screen is comparing two texts and the rest of the list never needs one.
 * The diff is against the text the chapter holds *now*, not against the neighbouring version:
 * "what would restoring this change" is the question being asked, and the answer stays true
 * even after an intermediate restore.
 *
 * Restoring is not an undo of the record — it appends. That is why the newest row is always
 * the current text, and why a restore is available again afterwards as a version of its own.
 */
export function ChapterHistoryDialog({
  chapter,
  novelId,
  onOpenChange,
}: ChapterHistoryDialogProps) {
  const t = useTranslations("history");
  const tRoot = useTranslations();
  const locale = useLocale() as Locale;
  const queryClient = useQueryClient();

  const open = chapter !== null;
  const chapterId = chapter?.id ?? "";
  const historyQuery = useQuery(chapterHistoryQueryOptions(chapterId, open));
  const chapterQuery = useQuery({ ...chapterQueryOptions(chapterId, novelId), enabled: open });

  // The choice is stored with the chapter it belongs to, so opening a different chapter shows
  // that chapter's default rather than carrying the previous one's selection across. Deriving
  // it during render is what keeps the reset free of an effect that renders twice.
  const [selection, setSelection] = useState<{ chapterId: string; versionId: string | null }>({
    chapterId: "",
    versionId: null,
  });
  const [restoreTarget, setRestoreTarget] = useState<{
    chapterId: string;
    versionId: string;
  } | null>(null);

  const selectedId = selection.chapterId === chapterId ? selection.versionId : null;
  const restoreOpen = restoreTarget !== null && restoreTarget.chapterId === chapterId;

  // The newest row is the current text by construction, so comparing it with itself says
  // nothing; the useful default is the generation before it.
  const versions = historyQuery.data;
  const defaultVersionId = versions ? ((versions[1] ?? versions[0])?.id ?? null) : null;
  const activeVersionId = selectedId ?? defaultVersionId;

  const versionQuery = useQuery(chapterVersionQueryOptions(activeVersionId));
  const current = chapterQuery.data?.translatedContent ?? null;
  // A bulk delete clears the text and keeps the trail, so "no translation" is a state the
  // history has to serve rather than a reason to show nothing. It only counts once the
  // chapter read has answered — before that, an absent body is a pending read.
  const cleared = chapterQuery.isSuccess && !current?.trim();
  const isCurrentVersion = !cleared && versions?.[0]?.id === activeVersionId;

  const diff = useMemo(() => {
    if (!versionQuery.data || cleared || current === null) return null;
    return diffChapterTranslations(versionQuery.data.content, current);
  }, [cleared, current, versionQuery.data]);

  // With no current text there is nothing to compare against, and showing the version's own
  // paragraphs struck through as "removed" would read as the opposite of what restoring does.
  const restoredParagraphs = useMemo(
    () => (cleared && versionQuery.data ? splitParagraphs(versionQuery.data.content) : null),
    [cleared, versionQuery.data],
  );

  const restore = useMutation({
    mutationFn: (versionId: string) => restoreChapterTranslationVersion({ data: { versionId } }),
    onSuccess: (_result, versionId) => {
      toast.success(t("restored"));
      void queryClient.invalidateQueries({ queryKey: ["chapterHistory", chapterId] });
      void queryClient.invalidateQueries({ queryKey: ["chapter", chapterId] });
      void queryClient.invalidateQueries({ queryKey: ["chapters"] });
      void queryClient.invalidateQueries({ queryKey: ["novels"] });
      void queryClient.invalidateQueries({ queryKey: ["chapterVersion", versionId] });
      setRestoreTarget(null);
      setSelection({ chapterId, versionId: null });
    },
    onError: (error: unknown) =>
      toast.error(translateServerError(error, tRoot, t("restoreFailed"))),
  });

  const originLabel = (origin: string) => {
    switch (origin) {
      case "manual":
        return t("originManual");
      case "glossary":
        return t("originGlossary");
      case "rollback":
        return t("originRollback");
      case "import":
        return t("originImport");
      default:
        return t("originTranslation");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {chapter ? t("title", { number: Number(chapter.number) }) : t("action")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {historyQuery.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : historyQuery.isError ? (
          <QueryErrorState
            error={historyQuery.error}
            title={t("loadFailed")}
            onRetry={() => void historyQuery.refetch()}
          />
        ) : versions && versions.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-[17rem_minmax(0,1fr)]">
            <ul className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1">
              {versions.map((version, index) => {
                const selected = version.id === activeVersionId;
                return (
                  <li key={version.id}>
                    <button
                      type="button"
                      onClick={() => setSelection({ chapterId, versionId: version.id })}
                      aria-pressed={selected}
                      className={
                        selected
                          ? "flex w-full flex-col gap-0.5 rounded-md bg-surface px-3 py-2 text-left text-foreground"
                          : "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-muted-foreground transition-colors duration-150 hover:bg-surface hover:text-foreground"
                      }
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-body">{originLabel(version.origin)}</span>
                        {/* After a clear, even the newest row is not the chapter's text. */}
                        {index === 0 && !cleared ? (
                          <Badge variant="outline" className="text-badge-count uppercase">
                            {t("current")}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-caption">
                        {formatDateTime(version.createdAt, locale)} ·{" "}
                        {t("characters", { count: formatNumber(version.charCount, locale) })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex min-w-0 flex-col gap-3">
              {activeVersionId === null || versionQuery.isPending ? (
                activeVersionId === null ? (
                  <p className="py-8 text-center text-body text-muted-foreground">
                    {t("selectHint")}
                  </p>
                ) : (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                )
              ) : versionQuery.isError ? (
                <QueryErrorState
                  error={versionQuery.error}
                  title={t("versionFailed")}
                  onRetry={() => void versionQuery.refetch()}
                />
              ) : versionQuery.data && (diff || restoredParagraphs) ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p
                      className={
                        cleared ? "text-caption text-warning" : "text-caption text-muted-foreground"
                      }
                    >
                      {cleared
                        ? t("clearedNotice")
                        : t("compareLabel", {
                            date: formatDateTime(versionQuery.data.createdAt, locale),
                          })}
                    </p>
                    {diff ? (
                      <p className="flex gap-3 text-caption tabular-nums">
                        <span className="text-success">{t("added", { count: diff.added })}</span>
                        <span className="text-destructive-text">
                          {t("removed", { count: diff.removed })}
                        </span>
                        <span className="text-muted-foreground">
                          {t("unchanged", { count: diff.unchanged })}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  {versionQuery.data.sourceRevision !== versions[0]?.sourceRevision ? (
                    <p className="text-caption text-warning">
                      {t("sourceRevisionOlder", { revision: versionQuery.data.sourceRevision })}
                    </p>
                  ) : null}

                  <ol className="max-h-[45vh] overflow-y-auto rounded-lg border border-border">
                    {diff
                      ? diff.lines.map((line, index) => (
                          <li
                            key={`${index}-${line.kind}`}
                            className={
                              line.kind === "added"
                                ? "border-l-2 border-success bg-success/5 px-3 py-1.5 text-body text-foreground"
                                : line.kind === "removed"
                                  ? "border-l-2 border-destructive bg-destructive/5 px-3 py-1.5 text-body text-muted-foreground line-through"
                                  : "px-3 py-1.5 text-body text-muted-foreground"
                            }
                          >
                            {line.kind === "added" ? (
                              <span className="sr-only">{t("addedParagraph")}: </span>
                            ) : line.kind === "removed" ? (
                              <span className="sr-only">{t("removedParagraph")}: </span>
                            ) : null}
                            {line.text}
                          </li>
                        ))
                      : restoredParagraphs?.map((paragraph, index) => (
                          <li
                            key={`${index}-restored`}
                            className="px-3 py-1.5 text-body text-foreground"
                          >
                            {paragraph}
                          </li>
                        ))}
                  </ol>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      disabled={isCurrentVersion || restore.isPending}
                      onClick={() => {
                        if (activeVersionId) {
                          setRestoreTarget({ chapterId, versionId: activeVersionId });
                        }
                      }}
                    >
                      <History className="size-4" aria-hidden="true" />
                      {t("restore")}
                    </Button>
                  </DialogFooter>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} size="compact" />
        )}

        <ConfirmDialog
          title={t("restoreTitle")}
          description={cleared ? t("restoreClearedDescription") : t("restoreDescription")}
          confirmText={restore.isPending ? t("restoring") : t("restoreConfirm")}
          open={restoreOpen}
          onOpenChange={(next) => {
            if (!next) setRestoreTarget(null);
          }}
          onConfirm={() => {
            if (restoreTarget) restore.mutate(restoreTarget.versionId);
          }}
          pending={restore.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
