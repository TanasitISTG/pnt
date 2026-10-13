import { useQuery } from "@tanstack/react-query";
import { previewTranslationBatch } from "@/lib/translation/api/mutations";
import { formatCost } from "@/lib/utils";
import { ChapterReorderDialog } from "@/components/chapters/reorder/chapter-reorder-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { JobLogsDialog } from "@/components/translation/job/job-logs-dialog";
import type { ChapterRow } from "@/components/chapters/types";
import type { TranslationStartMode } from "@/lib/translation/api/schemas";

export interface NovelDetailDialogData {
  novelId: string;
  reorder: {
    chapters: ChapterRow[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (chapterIds: string[]) => Promise<void>;
  };
  deleteNovel: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    pending: boolean;
  };
  deleteTranslations: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    pending: boolean;
  };
  deleteChapter: {
    chapterId: string | null;
    setChapterId: (chapterId: string | null) => void;
    remove: (variables: { chapterId: string }) => void;
    pending: boolean;
  };
  logs: {
    chapterId: string | null;
    setChapterId: (chapterId: string | null) => void;
  };
  retranslate: {
    chapterId: string | null;
    setChapterId: (chapterId: string | null) => void;
    start: (chapterId: string, mode: TranslationStartMode) => void;
  };
  batchRetranslate: {
    chapterIds: string[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    pending: boolean;
    onConfirm: () => Promise<void>;
  };
  stopSelected: {
    count: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    pending: boolean;
    onConfirm: () => Promise<void>;
  };
}

export interface NovelDetailDialogsProps {
  detail: NovelDetailDialogData;
}

export function NovelDetailDialogs({ detail }: NovelDetailDialogsProps) {
  const { novelId, reorder, deleteNovel, deleteTranslations, deleteChapter } = detail;
  const { logs, retranslate, batchRetranslate, stopSelected } = detail;
  const selectedTranslatedIds = batchRetranslate.chapterIds;
  const selectedTranslatedCount = selectedTranslatedIds.length;
  const selectedActiveCount = stopSelected.count;
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
    enabled: batchRetranslate.open && selectedTranslatedIds.length > 0,
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
      {reorder.open ? (
        <ChapterReorderDialog
          key={JSON.stringify(reorder.chapters.map((chapter) => [chapter.id, chapter.number]))}
          chapters={reorder.chapters}
          onOpenChange={reorder.onOpenChange}
          onSave={reorder.onSave}
        />
      ) : null}
      <DeleteConfirmDialog
        title="Delete Novel Project"
        description="Are you absolutely sure you want to delete this novel? This action is permanent and will delete all chapters, glossaries, and translation jobs associated with it."
        open={deleteNovel.open}
        onOpenChange={deleteNovel.onOpenChange}
        onConfirm={deleteNovel.onConfirm}
        pending={deleteNovel.pending}
      />
      <DeleteConfirmDialog
        title="Delete All Translations"
        description="This permanently deletes translated titles, chapter text, chapter summaries, and the story summary for this novel. Active translation jobs will be cancelled. Raw chapters, publishing settings, and translation job history are kept."
        open={deleteTranslations.open}
        onOpenChange={deleteTranslations.onOpenChange}
        onConfirm={deleteTranslations.onConfirm}
        pending={deleteTranslations.pending}
      />
      <ConfirmDialog
        title="Re-translate selected chapters?"
        description={`This will overwrite the existing translations for ${selectedTranslatedCount} selected chapter${selectedTranslatedCount === 1 ? "" : "s"} with new machine translations. ${previewDescription}`}
        confirmText={
          previewQuery.isPending
            ? "Preparing preview…"
            : batchRetranslate.pending
              ? "Re-translating…"
              : "Re-translate chapters"
        }
        open={batchRetranslate.open}
        onOpenChange={batchRetranslate.onOpenChange}
        onConfirm={() => {
          if (!previewQuery.isPending) void batchRetranslate.onConfirm();
        }}
        pending={batchRetranslate.pending || previewQuery.isPending}
      />
      <ConfirmDialog
        title="Stop selected translations?"
        description={`This will cancel ${selectedActiveCount} queued or running translation${selectedActiveCount === 1 ? "" : "s"}. Existing completed translations will stay unchanged.`}
        confirmText={stopSelected.pending ? "Stopping…" : "Stop translations"}
        variant="destructive"
        open={stopSelected.open}
        onOpenChange={stopSelected.onOpenChange}
        onConfirm={stopSelected.onConfirm}
        pending={stopSelected.pending}
      />
      <DeleteConfirmDialog
        title="Delete Chapter"
        description="Are you sure you want to delete this chapter? This action is permanent and cannot be undone."
        open={deleteChapter.chapterId !== null}
        onOpenChange={(open) => !open && deleteChapter.setChapterId(null)}
        onConfirm={() => {
          const chapterId = deleteChapter.chapterId;
          if (chapterId) deleteChapter.remove({ chapterId });
        }}
        pending={deleteChapter.pending}
      />
      <JobLogsDialog
        chapterId={logs.chapterId}
        open={logs.chapterId !== null}
        onOpenChange={(open) => !open && logs.setChapterId(null)}
      />
      <ConfirmDialog
        title="Overwrite Existing Translation?"
        description="This chapter already has a translation. Re-translating will replace it; any manual changes will be lost."
        confirmText="Overwrite & Translate"
        open={retranslate.chapterId !== null}
        onOpenChange={(open) => !open && retranslate.setChapterId(null)}
        onConfirm={() => {
          const chapterId = retranslate.chapterId;
          if (chapterId) {
            retranslate.start(chapterId, "overwrite");
            retranslate.setChapterId(null);
          }
        }}
      />
    </>
  );
}
