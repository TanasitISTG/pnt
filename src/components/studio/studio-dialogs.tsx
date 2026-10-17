import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "use-intl";
import { previewTranslationBatch } from "@/lib/translation/api/mutations";
import { formatCost } from "@/lib/utils";
import { ChapterReorderDialog } from "@/components/chapters/reorder/chapter-reorder-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { JobLogDrawer } from "@/components/translation/job/job-log-drawer";
import { formatNumber } from "@/lib/i18n/format";
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
  const t = useTranslations("studio");
  const locale = useLocale();
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
  // Each sentence of the preview is its own message; the paragraph is the sentences joined,
  // so no sentence is ever half a key.
  const previewDescription = previewQuery.isPending
    ? t("previewPreparing")
    : previewQuery.isError
      ? t("previewUnavailable")
      : previewQuery.data
        ? [
            t("previewEligible", { count: previewQuery.data.eligibleIds.length }),
            t("previewSkipped", { count: previewQuery.data.skipped.length }),
            t("previewRawText", {
              characters: formatNumber(previewQuery.data.rawCharacterTotal, locale),
            }),
            t("previewAlreadyTranslated", {
              count: previewQuery.data.existingTranslationCount,
            }),
            t("previewManualEdits", { count: previewQuery.data.manualEditCount }),
            previewQuery.data.estimate
              ? previewQuery.data.estimate.cost !== null
                ? t("previewEstimatePriced", {
                    samples: previewQuery.data.estimate.sampleSize,
                    prompt: formatNumber(previewQuery.data.estimate.promptTokens, locale),
                    completion: formatNumber(previewQuery.data.estimate.completionTokens, locale),
                    cost: formatCost(previewQuery.data.estimate.cost),
                  })
                : t("previewEstimateUnpriced", {
                    samples: previewQuery.data.estimate.sampleSize,
                    prompt: formatNumber(previewQuery.data.estimate.promptTokens, locale),
                    completion: formatNumber(previewQuery.data.estimate.completionTokens, locale),
                  })
              : t("previewNoEstimate"),
          ].join(" ")
        : t("previewNoSelection");

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
        title={t("deleteNovelTitle")}
        description={t("deleteNovelDescription")}
        open={deleteNovel.open}
        onOpenChange={deleteNovel.onOpenChange}
        onConfirm={deleteNovel.onConfirm}
        pending={deleteNovel.pending}
      />
      <DeleteConfirmDialog
        title={t("deleteAllTranslationsTitle")}
        description={t("deleteAllTranslationsDescription")}
        open={deleteTranslations.open}
        onOpenChange={deleteTranslations.onOpenChange}
        onConfirm={deleteTranslations.onConfirm}
        pending={deleteTranslations.pending}
      />
      <ConfirmDialog
        title={t("batchRetranslateTitle")}
        description={t("batchRetranslateDescription", {
          count: selectedTranslatedCount,
          preview: previewDescription,
        })}
        confirmText={
          previewQuery.isPending
            ? t("previewPreparingShort")
            : batchRetranslate.pending
              ? t("retranslatingChapters")
              : t("retranslateChapters")
        }
        open={batchRetranslate.open}
        onOpenChange={batchRetranslate.onOpenChange}
        onConfirm={() => {
          if (!previewQuery.isPending) void batchRetranslate.onConfirm();
        }}
        pending={batchRetranslate.pending || previewQuery.isPending}
      />
      <ConfirmDialog
        title={t("stopSelectedTitle")}
        description={t("stopSelectedDescription", { count: selectedActiveCount })}
        confirmText={stopSelected.pending ? t("stoppingTranslations") : t("stopTranslations")}
        variant="destructive"
        open={stopSelected.open}
        onOpenChange={stopSelected.onOpenChange}
        onConfirm={stopSelected.onConfirm}
        pending={stopSelected.pending}
      />
      <DeleteConfirmDialog
        title={t("deleteChapterTitle")}
        description={t("deleteChapterDescription")}
        open={deleteChapter.chapterId !== null}
        onOpenChange={(open) => !open && deleteChapter.setChapterId(null)}
        onConfirm={() => {
          const chapterId = deleteChapter.chapterId;
          if (chapterId) deleteChapter.remove({ chapterId });
        }}
        pending={deleteChapter.pending}
      />
      <JobLogDrawer
        chapterId={logs.chapterId}
        open={logs.chapterId !== null}
        onOpenChange={(open) => !open && logs.setChapterId(null)}
      />
      <ConfirmDialog
        title={t("overwriteTitle")}
        description={t("overwriteDescription")}
        confirmText={t("overwriteConfirm")}
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
