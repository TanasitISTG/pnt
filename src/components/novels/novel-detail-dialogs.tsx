import { ChapterReorderDialog } from "@/components/chapters/chapter-reorder-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { JobLogsDialog } from "@/components/translation/job-logs-dialog";
import type { ChapterRow } from "@/components/chapters/types";

export interface NovelDetailDialogDetail {
  chapters: ChapterRow[];
  reorderOpen: boolean;
  setReorderOpen: (open: boolean) => void;
  reorderingChapters: boolean;
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
  stopSelectedOpen: boolean;
  setStopSelectedOpen: (open: boolean) => void;
  selectedActiveCount: number;
  batchStopping: boolean;
  confirmStopSelectedTranslations: () => Promise<void>;
  startTranslate: (chapterId: string) => void;
}

export interface NovelDetailDialogsProps {
  detail: NovelDetailDialogDetail;
}

export function NovelDetailDialogs({ detail }: NovelDetailDialogsProps) {
  const {
    chapters,
    reorderOpen,
    setReorderOpen,
    reorderingChapters,
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
    stopSelectedOpen,
    setStopSelectedOpen,
    selectedActiveCount,
    batchStopping,
    confirmStopSelectedTranslations,
    startTranslate,
  } = detail;

  return (
    <>
      {reorderOpen ? (
        <ChapterReorderDialog
          chapters={chapters}
          saving={reorderingChapters}
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
        title="Overwrite Edited Translation?"
        description="This chapter was manually edited. Re-translating will overwrite your manual changes with a new machine translation."
        confirmText="Overwrite & Translate"
        open={retranslateChapterId !== null}
        onOpenChange={(open) => !open && setRetranslateChapterId(null)}
        onConfirm={() => {
          if (retranslateChapterId) {
            startTranslate(retranslateChapterId);
            setRetranslateChapterId(null);
          }
        }}
      />
    </>
  );
}
