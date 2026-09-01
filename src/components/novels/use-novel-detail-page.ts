import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { getNovel } from "@/lib/content/novel.functions";
import { listChapters } from "@/lib/content/chapter.functions";
import { getResidualHanziChapters } from "@/lib/content/chapter-ops.functions";
import type { ReaderProgress } from "@/lib/reader/types";
import { getGlossaryStats } from "@/lib/glossary/functions";
import { getNovelCosts } from "@/lib/translation/api/queries";
import { getReaderProgress } from "@/lib/reader/progress";
import { useChapterSelection } from "@/components/chapters/use-chapter-selection";
import { useChapterTitleEdit } from "@/components/chapters/use-chapter-title-edit";
import { useNovelDetailMutations } from "@/components/novels/use-novel-detail-mutations";
import { useNovelExport } from "@/components/novels/use-novel-export";
import { useTranslationJob } from "@/components/translation/use-translation-job";

const EMPTY_CHAPTERS: never[] = [];
const EMPTY_RESIDUAL_HANZI: never[] = [];
const READER_PROGRESS_STORAGE_KEY = "pnt-reader-progress";
const EMPTY_READER_PROGRESS: ReaderProgress = {
  lastChapterId: null,
  readChapterIds: [],
};

function getServerReaderProgressSnapshot() {
  return EMPTY_READER_PROGRESS;
}
function subscribeToNothing() {
  return () => {};
}

function getClientReadySnapshot() {
  return true;
}

function getServerReadySnapshot() {
  return false;
}

export const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
  });

export const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId],
    queryFn: () => listChapters({ data: { novelId } }),
  });

export const glossaryStatsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["glossaryStats", novelId],
    queryFn: () => getGlossaryStats({ data: { novelId } }),
  });

export const costsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["costs", novelId],
    queryFn: () => getNovelCosts({ data: { novelId } }),
  });

export const residualHanziQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["residualHanzi", novelId],
    queryFn: () => getResidualHanziChapters({ data: { novelId } }),
  });

export function useNovelDetailPage(novelId: string, isAdmin: boolean) {
  const queryClient = useQueryClient();
  const novelQuery = useQuery(novelQueryOptions(novelId));
  const chaptersQuery = useQuery(chaptersQueryOptions(novelId));
  const glossaryStatsQuery = useQuery({
    ...glossaryStatsQueryOptions(novelId),
    enabled: isAdmin && chaptersQuery.isSuccess,
  });
  const costsQuery = useQuery({
    ...costsQueryOptions(novelId),
    enabled: isAdmin && chaptersQuery.isSuccess,
  });
  const residualHanziQuery = useQuery({
    ...residualHanziQueryOptions(novelId),
    enabled: isAdmin && chaptersQuery.isSuccess,
  });

  const chapters = chaptersQuery.data ?? EMPTY_CHAPTERS;
  const residualHanziChapters = residualHanziQuery.data ?? EMPTY_RESIDUAL_HANZI;
  const residualHanziMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of residualHanziChapters) {
      map.set(item.chapterId, item.count);
    }
    return map;
  }, [residualHanziChapters]);

  const readerProgressStore = useMemo(() => {
    let snapshot: ReaderProgress | null = null;
    const getSnapshot = () => {
      if (!snapshot) snapshot = getReaderProgress(novelId);
      return snapshot;
    };
    const subscribe = (onStoreChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const handleStorage = (event: StorageEvent) => {
        if (event.key !== READER_PROGRESS_STORAGE_KEY) return;
        snapshot = null;
        onStoreChange();
      };
      window.addEventListener("storage", handleStorage);
      return () => window.removeEventListener("storage", handleStorage);
    };
    return { getSnapshot, subscribe };
  }, [novelId]);
  const readerProgress = useSyncExternalStore(
    readerProgressStore.subscribe,
    readerProgressStore.getSnapshot,
    getServerReaderProgressSnapshot,
  );
  const readerProgressReady = useSyncExternalStore(
    subscribeToNothing,
    getClientReadySnapshot,
    getServerReadySnapshot,
  );
  const readChapterIdSet = useMemo(
    () => new Set(readerProgress.readChapterIds),
    [readerProgress.readChapterIds],
  );
  const [retranslateChapterId, setRetranslateChapterId] = useState<string | null>(null);
  const [deleteNovelOpen, setDeleteNovelOpen] = useState(false);
  const [deleteAllTranslationsOpen, setDeleteAllTranslationsOpen] = useState(false);
  const [logChapterId, setLogChapterId] = useState<string | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);

  const lastReadChapter = useMemo(() => {
    if (!readerProgress.lastChapterId) return null;
    return chapters.find((chapter) => chapter.id === readerProgress.lastChapterId) ?? null;
  }, [chapters, readerProgress.lastChapterId]);

  const firstChapter = chapters[0] ?? null;
  const chaptersReady = chaptersQuery.isSuccess && !chaptersQuery.isError;
  const chapterUiLoading = isAdmin && (chaptersQuery.isPending || !readerProgressReady);

  const {
    start: startTranslate,
    startMany: startBatchTranslate,
    cancel: cancelTranslate,
    retry: retryTranslate,
    clearActiveJobs,
    activeJobs,
  } = useTranslationJob(novelId, isAdmin && chaptersReady);

  const handleTranslationsDeleted = useCallback(() => {
    clearActiveJobs();
    setDeleteAllTranslationsOpen(false);
  }, [clearActiveJobs]);

  const {
    selectedIds,
    setSelectedIds,
    selectableIds,
    toggleSelect,
    toggleSelectMany,
    selectByRange,
    batchStarting,
    batchRangeFrom,
    setBatchRangeFrom,
    batchRangeTo,
    setBatchRangeTo,
    handleBatchTranslate,
    isRowTranslating,
  } = useChapterSelection(chapters, activeJobs, startBatchTranslate);

  const {
    editState,
    setEditState,
    editErrors,
    savingTitle,
    handleStartEdit,
    handleSaveEdit,
    handleTitleChange,
  } = useChapterTitleEdit(novelId);

  const {
    removeNovel,
    deletingNovel,
    publishNovel,
    publishingNovel,
    removeChapter,
    deletingChapter,
    deleteChapterId,
    setDeleteChapterId,
    publishChapter,
    publishingChapterId,
    publishAllChapters,
    publishingAll,
    backfillTitles,
    backfillingTitles,
    deleteAllTranslations,
    deletingAllTranslations,
    saveChapterOrder,
    reorderingChapters,
  } = useNovelDetailMutations(novelId, handleTranslationsDeleted);

  const handleSaveChapterOrder = useCallback(
    async (chapterIds: string[]) => {
      await saveChapterOrder(chapterIds);
    },
    [saveChapterOrder],
  );
  const reorderDisabled =
    reorderingChapters || chapters.some((chapter) => isRowTranslating(chapter.id, chapter.status));
  const handleCancelEdit = useCallback(() => {
    setEditState(null);
  }, [setEditState]);
  const invalidateChapters = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
  }, [queryClient, novelId]);

  const missingTitleCount = useMemo(
    () =>
      chapters.filter((chapter) => chapter.status === "translated" && !chapter.translatedTitle)
        .length,
    [chapters],
  );
  const unpublishedCount = useMemo(
    () =>
      chapters.filter(
        (chapter) => !chapter.publishedAt || new Date(chapter.publishedAt) > new Date(),
      ).length,
    [chapters],
  );
  const { exporting, handleExportTxt, handleExportEpub } = useNovelExport(novelId);

  const chapterTableProps = {
    novelId,
    isAdmin,
    activeJobs,
    readChapterIdSet,
    residualHanziMap,
    costData: costsQuery.data,
    selectedIds,
    isTranslating: isRowTranslating,
    onToggleSelect: toggleSelect,
    onToggleSelectAll: toggleSelectMany,
    publishingChapterId,
    onPublishChapter: publishChapter,
    onCancelTranslate: cancelTranslate,
    onRetryTranslate: retryTranslate,
    onStartTranslate: startTranslate,
    onRequestRetranslate: setRetranslateChapterId,
    onViewLogs: setLogChapterId,
    titleEdit: editState,
    editErrors,
    savingTitle,
    onTitleChange: handleTitleChange,
    onSaveTitle: handleSaveEdit,
    onStartEdit: handleStartEdit,
    onCancelEdit: handleCancelEdit,
    onDeleteChapter: setDeleteChapterId,
  };

  return {
    activeJobs,
    backfillTitles,
    backfillingTitles,
    batchRangeFrom,
    batchRangeTo,
    batchStarting,
    cancelTranslate,
    chapterTableProps,
    chapterUiLoading,
    chapters,
    chaptersError: chaptersQuery.error,
    chaptersReady,
    deleteAllTranslations,
    deleteAllTranslationsOpen,
    deleteChapterId,
    deleteNovelOpen,
    deletingAllTranslations,
    deletingChapter,
    deletingNovel,
    exporting,
    firstChapter,
    costData: costsQuery.data,
    glossaryStats: glossaryStatsQuery.data,
    handleBatchTranslate,
    handleExportEpub,
    handleExportTxt,
    handleSaveChapterOrder,
    invalidateChapters,
    isChaptersError: chaptersQuery.isError,
    isChaptersPending: chaptersQuery.isPending,
    isNovelError: novelQuery.isError,
    lastReadChapter,
    missingTitleCount,
    novel: novelQuery.data,
    novelError: novelQuery.error,
    publishAllChapters,
    publishChapter,
    publishNovel,
    publishingAll,
    publishingChapterId,
    publishingNovel,
    refetchChapters: chaptersQuery.refetch,
    refetchNovel: novelQuery.refetch,
    removeChapter,
    removeNovel,
    reorderDisabled,
    reorderOpen,
    reorderingChapters,
    retryTranslate,
    selectableIds,
    selectedIds,
    setDeleteAllTranslationsOpen,
    setBatchRangeFrom,
    setBatchRangeTo,
    setDeleteChapterId,
    setDeleteNovelOpen,
    setLogChapterId,
    setRetranslateChapterId,
    setReorderOpen,
    setSelectedIds,
    startTranslate,
    unpublishedCount,
    logChapterId,
    selectByRange,
    retranslateChapterId,
  };
}
