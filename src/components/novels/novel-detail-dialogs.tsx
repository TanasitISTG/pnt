import { useQuery } from "@tanstack/react-query";
import { previewTranslationBatch } from "@/lib/translation/api/mutations";
import { formatCost } from "@/lib/utils";
import { ChapterReorderDialog } from "@/components/chapters/chapter-reorder-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { JobLogsDialog } from "@/components/translation/job-logs-dialog";
import type { ChapterRow } from "@/components/chapters/types";
import type { TranslationStartMode } from "@/lib/translation/api/schemas";

export interface NovelDetailDialogDetail {
  novelId: string;
  selectedTranslatedIds: string[];
  chapters: ChapterRow[];
  reorderOpen: boolean;
  setReorderOpen: (open: boolean) => void;
  handleSaveChapterOrder: (chapterIds: string[]) => Promise<void>;
  deleteNovelOpen: boolean;
  setDeleteNovelOpen: (open: boolean) => void;
  removeNovel: () => void;
  deletingNovel: boolean;
  deleteAllTranslationsOpen: boolean;
  setDeleteAllTranslationsOpen: (open: boolean) => void;
  deleteAllTranslations: () => void;
  deletingAllTranslations: boolean;
  deleteChapterId: string | null;
  setDeleteChapterId: (chapterId: string | null) => void;
  removeChapter: (variables: { chapterId: string }) => void;
  deletingChapter: boolean;
  logChapterId: string | null;
  setLogChapterId: (chapterId: string | null) => void;
  retranslateChapterId: string | null;
  setRetranslateChapterId: (chapterId: string | null) => void;
  batchRetranslateOpen: boolean;
  setBatchRetranslateOpen: (open: boolean) => void;
  selectedTranslatedCount: number;
  batchStarting: boolean;
  confirmBatchRetranslate: () => Promise<void>;
  stopSelectedOpen: boolean;
  setStopSelectedOpen: (open: boolean) => void;
  selectedActiveCount: number;
  batchStopping: boolean;
  confirmStopSelectedTranslations: () => Promise<void>;
  startTranslate: (chapterId: string, mode: TranslationStartMode) => void;
}

export interface NovelDetailDialogsProps {
  detail: NovelDetailDialogDetail;
}

export function NovelDetailDialogs({ detail }: NovelDetailDialogsProps) {
  const {
    novelId,
    selectedTranslatedIds,
    chapters,
    reorderOpen,
    setReorderOpen,
    handleSaveChapterOrder,
    deleteNovelOpen,
    setDeleteNovelOpen,
    removeNovel,
    deletingNovel,
    deleteAllTranslationsOpen,
    setDeleteAllTranslationsOpen,
    deleteAllTranslations,
    deletingAllTranslations,
    deleteChapterId,
    setDeleteChapterId,
    removeChapter,
    deletingChapter,
    logChapterId,
    setLogChapterId,
    retranslateChapterId,
    setRetranslateChapterId,
    batchRetranslateOpen,
    setBatchRetranslateOpen,
    selectedTranslatedCount,
    batchStarting,
    confirmBatchRetranslate,
    stopSelectedOpen,
    setStopSelectedOpen,
    selectedActiveCount,
    batchStopping,
    confirmStopSelectedTranslations,
    startTranslate,
  } = detail;
  const previewQuery = useQuery({
    queryKey: ["translationBatchPreview", novelId, selectedTranslatedIds],
    queryFn: () =>
      previewTranslationBatch({
        data: {
          novelId,
          chapterIds: selectedTranslatedIds,
          mode: "overwrite",
        },
      }),
    enabled: batchRetranslateOpen && selectedTranslatedIds.length > 0,
    staleTime: 30_000,
  });
  const previewDescription = previewQuery.isPending
    ? "Preparing a translation preview…"
    : previewQuery.isError
      ? "Preview unavailable. You can retry the preview by closing and reopening this confirmation."
      : previewQuery.data
        ? [
            `Eligible: ${previewQuery.data.eligibleIds.length}.`,
            `Skipped: ${previewQuery.data.skipped.length}.`,
            `Raw text: ${previewQuery.data.rawCharacterTotal.toLocaleString()} characters.`,
            `Already translated: ${previewQuery.data.existingTranslationCount}.`,
            `Manual edits: ${previewQuery.data.manualEditCount}.`,
            previewQuery.data.estimate
              ? `Estimate from ${previewQuery.data.estimate.sampleSize} recent successful jobs: ${previewQuery.data.estimate.promptTokens.toLocaleString()} prompt + ${previewQuery.data.estimate.completionTokens.toLocaleString()} completion tokens${previewQuery.data.estimate.cost !== null ? `, ${formatCost(previewQuery.data.estimate.cost)}` : " (pricing unavailable)"}.`
              : "No token estimate yet; at least three successful jobs with usage are required.",
          ].join(" ")
        : "No chapters are selected for re-translation.";

  return (
    <>
      {reorderOpen ? (
        <ChapterReorderDialog
          chapters={chapters}
          onOpenChange={setReorderOpen}
          onSave={handleSaveChapterOrder}
        />
      ) : null}
      <DeleteConfirmDialog
        title="Delete Novel Project"
        description="Are you absolutely sure you want to delete this novel? This action is permanent and will delete all chapters, glossaries, and translation jobs associated with it."
        open={deleteNovelOpen}
        onOpenChange={setDeleteNovelOpen}
        onConfirm={removeNovel}
        pending={deletingNovel}
      />
      <DeleteConfirmDialog
        title="Delete All Translations"
        description="This permanently deletes translated titles, chapter text, chapter summaries, and the story summary for this novel. Active translation jobs will be cancelled. Raw chapters, publishing settings, and translation job history are kept."
        open={deleteAllTranslationsOpen}
        onOpenChange={setDeleteAllTranslationsOpen}
        onConfirm={deleteAllTranslations}
        pending={deletingAllTranslations}
      />
      <ConfirmDialog
        title="Re-translate selected chapters?"
        description={`This will overwrite the existing translations for ${selectedTranslatedCount} selected chapter${selectedTranslatedCount === 1 ? "" : "s"} with new machine translations. ${previewDescription}`}
        confirmText={
          previewQuery.isPending
            ? "Preparing preview…"
            : batchStarting
              ? "Re-translating…"
              : "Re-translate chapters"
        }
        open={batchRetranslateOpen}
        onOpenChange={setBatchRetranslateOpen}
        onConfirm={() => {
          if (!previewQuery.isPending) void confirmBatchRetranslate();
        }}
        pending={batchStarting || previewQuery.isPending}
      />
      <ConfirmDialog
        title="Stop selected translations?"
        description={`This will cancel ${selectedActiveCount} queued or running translation${selectedActiveCount === 1 ? "" : "s"}. Existing completed translations will stay unchanged.`}
        confirmText={batchStopping ? "Stopping…" : "Stop translations"}
        variant="destructive"
        open={stopSelectedOpen}
        onOpenChange={setStopSelectedOpen}
        onConfirm={confirmStopSelectedTranslations}
        pending={batchStopping}
      />
      <DeleteConfirmDialog
        title="Delete Chapter"
        description="Are you sure you want to delete this chapter? This action is permanent and cannot be undone."
        open={deleteChapterId !== null}
        onOpenChange={(open) => !open && setDeleteChapterId(null)}
        onConfirm={() => deleteChapterId && removeChapter({ chapterId: deleteChapterId })}
        pending={deletingChapter}
      />
      <JobLogsDialog
        chapterId={logChapterId}
        open={logChapterId !== null}
        onOpenChange={(open) => !open && setLogChapterId(null)}
      />
      <ConfirmDialog
        title="Overwrite Existing Translation?"
        description="This chapter already has a translation. Re-translating will replace it; any manual changes will be lost."
        confirmText="Overwrite & Translate"
        open={retranslateChapterId !== null}
        onOpenChange={(open) => !open && setRetranslateChapterId(null)}
        onConfirm={() => {
          if (retranslateChapterId) {
            startTranslate(retranslateChapterId, "overwrite");
            setRetranslateChapterId(null);
          }
        }}
      />
    </>
  );
}
