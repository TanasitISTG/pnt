import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { getAdminNovelDetailMetrics, getNovel } from "@/lib/content/novel.functions";
import type { getAdminNovelDetailCore } from "@/lib/content/novel.functions";
import { listChapters } from "@/lib/content/chapter.functions";
import type { ReaderProgress } from "@/lib/reader/types";
import { getReaderProgress } from "@/lib/reader/progress";
import { useChapterSelection } from "@/components/chapters/use-chapter-selection";
import { useChapterTitleEdit } from "@/components/chapters/use-chapter-title-edit";
import { useNovelDetailMutations } from "@/components/novels/use-novel-detail-mutations";
import { useNovelExport } from "@/components/novels/use-novel-export";
import { useTranslationJob } from "@/components/translation/use-translation-job";
import { useHydrated } from "@/lib/use-hydrated";

const EMPTY_CHAPTERS: never[] = [];
const EMPTY_RESIDUAL_SCRIPTS: never[] = [];
const READER_PROGRESS_STORAGE_KEY = "pnt-reader-progress";
const EMPTY_READER_PROGRESS: ReaderProgress = {
  lastChapterId: null,
  readChapterIds: [],
};

function getServerReaderProgressSnapshot() {
  return EMPTY_READER_PROGRESS;
}

export const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId],
    queryFn: () => getNovel({ data: { novelId } }),
    staleTime: 10_000,
  });

export const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId],
    queryFn: () => listChapters({ data: { novelId } }),
    staleTime: 10_000,
  });

export const adminNovelDetailMetricsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["adminNovelDetailMetrics", novelId],
    queryFn: () => getAdminNovelDetailMetrics({ data: { novelId } }),
    staleTime: 5_000,
  });

type AdminNovelDetailCore = NonNullable<Awaited<ReturnType<typeof getAdminNovelDetailCore>>>;

export function hydrateAdminNovelDetailCore(
  queryClient: QueryClient,
  core: AdminNovelDetailCore,
): void {
  queryClient.setQueryData(["novel", core.novel.id], core.novel);
  queryClient.setQueryData(["chapters", core.novel.id], core.chapters);
}

export function useNovelDetailPage(novelId: string, isAdmin: boolean) {
  const queryClient = useQueryClient();
  const novelQuery = useQuery(novelQueryOptions(novelId));
  const chaptersQuery = useQuery(chaptersQueryOptions(novelId));
  const metricsQuery = useQuery({
    ...adminNovelDetailMetricsQueryOptions(novelId),
    enabled: isAdmin,
  });

  const chapters = chaptersQuery.data ?? EMPTY_CHAPTERS;
  const metrics = metricsQuery.data;
  const residualScriptChapters = metrics?.residualScriptChapters ?? EMPTY_RESIDUAL_SCRIPTS;
  const residualScriptMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of residualScriptChapters) {
      map.set(item.chapterId, item.count);
    }
    return map;
  }, [residualScriptChapters]);

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
  const readerProgressReady = useHydrated();
  const readChapterIdSet = useMemo(
    () => new Set(readerProgress.readChapterIds),
    [readerProgress.readChapterIds],
  );
  const [retranslateChapterId, setRetranslateChapterId] = useState<string | null>(null);
  const [deleteNovelOpen, setDeleteNovelOpen] = useState(false);
  const [deleteAllTranslationsOpen, setDeleteAllTranslationsOpen] = useState(false);
  const [logChapterId, setLogChapterId] = useState<string | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [stopSelectedOpen, setStopSelectedOpen] = useState(false);
  const [batchRetranslateOpen, setBatchRetranslateOpen] = useState(false);
  const lastReadChapter = useMemo(() => {
    if (!readerProgress.lastChapterId) return null;
    return chapters.find((chapter) => chapter.id === readerProgress.lastChapterId) ?? null;
  }, [chapters, readerProgress.lastChapterId]);

  const firstChapter = chapters[0] ?? null;
  const chaptersReady = chaptersQuery.isSuccess && !chaptersQuery.isError;
  const readingActionsPending = chaptersQuery.isPending || !readerProgressReady;
  const chapterUiLoading = isAdmin && readingActionsPending;

  const {
    start: startTranslate,
    startMany: startBatchTranslate,
    cancel: cancelTranslate,
    cancelMany,
    retry: retryTranslate,
    clearActiveJobs,
    activeJobs,
    activeJobsError,
    refetchActiveJobs,
  } = useTranslationJob(novelId, isAdmin && chaptersReady);

  const handleTranslationsDeleted = useCallback(() => {
    clearActiveJobs();
    setDeleteAllTranslationsOpen(false);
  }, [clearActiveJobs]);

  const {
    selectedIds,
    setSelectedIds,
    selectableIds,
    selectedMissingIds,
    selectedTranslatedIds,
    selectedActiveIds,
    toggleSelect,
    toggleSelectMany,
    selectByRange,
    batchStarting,
    batchStopping,
    batchRangeFrom,
    setBatchRangeFrom,
    batchRangeTo,
    setBatchRangeTo,
    handleBatchTranslate,
    handleBatchRetranslate,
    handleBatchStop,
    isRowTranslating,
  } = useChapterSelection(chapters, activeJobs, startBatchTranslate, cancelMany);

  const confirmStopSelectedTranslations = useCallback(async () => {
    if (await handleBatchStop()) setStopSelectedOpen(false);
  }, [handleBatchStop]);

  const confirmBatchRetranslate = useCallback(async () => {
    await handleBatchRetranslate();
    setBatchRetranslateOpen(false);
  }, [handleBatchRetranslate]);

  const {
    editState,
    setEditState,
    editErrors,
    savingTitle,
    handleStartEdit,
    handleSaveEdit,
    handleTitleChange,
  } = useChapterTitleEdit(novelId);
  const handleCancelEdit = useCallback(() => setEditState(null), [setEditState]);
  const missingTitleCount = useMemo(
    () => chapters.filter((chapter) => !chapter.translatedTitle?.trim()).length,
    [chapters],
  );

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
  const invalidateChapters = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chapters", novelId] });
    queryClient.invalidateQueries({ queryKey: ["readerChapterManifest", novelId] });
    queryClient.invalidateQueries({ queryKey: ["adminNovelDetailMetrics", novelId] });
    queryClient.invalidateQueries({ queryKey: ["novels"] });
  }, [queryClient, novelId]);
  const { readyUnpublishedCount, unreadyCount } = useMemo(() => {
    const now = new Date();
    let readyCount = 0;
    let unreadyChapterCount = 0;
    for (const chapter of chapters) {
      const ready = chapter.status === "translated" && chapter.hasTranslation;
      if (!ready) {
        unreadyChapterCount++;
      } else if (!chapter.publishedAt || new Date(chapter.publishedAt) > now) {
        readyCount++;
      }
    }
    return { readyUnpublishedCount: readyCount, unreadyCount: unreadyChapterCount };
  }, [chapters]);
  const { exporting, handleExportTxt, handleExportEpub } = useNovelExport(novelId);

  const chapterTableProps = {
    novelId,
    isAdmin,
    activeJobs,
    readChapterIdSet,
    residualScriptMap,
    costData: metrics?.costData,
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
    novelId,
    chapterTableProps,
    activeJobs,
    activeJobsError,
    refetchActiveJobs,
    backfillTitles,
    backfillingTitles,
    batchRangeFrom,
    batchRangeTo,
    batchStarting,
    batchStopping,
    cancelTranslate,
    chapterUiLoading,
    readingActionsPending,
    chapters,
    chaptersError: chaptersQuery.error,
    metricsError: metricsQuery.error,
    isMetricsError: metricsQuery.isError,
    refetchMetrics: metricsQuery.refetch,
    chaptersReady,
    confirmBatchRetranslate,
    confirmStopSelectedTranslations,
    batchRetranslateOpen,
    setBatchRetranslateOpen,
    deleteAllTranslations,
    deleteAllTranslationsOpen,
    deleteChapterId,
    deleteNovelOpen,
    deletingAllTranslations,
    deletingChapter,
    deletingNovel,
    exporting,
    firstChapter,
    costData: metrics?.costData,
    glossaryStats: metrics?.glossaryStats,
    handleBatchStop,
    handleBatchTranslate,
    handleExportEpub,
    onRequestBatchRetranslate: () => setBatchRetranslateOpen(true),
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
    selectedTranslatedCount: selectedTranslatedIds.length,
    selectedActiveCount: selectedActiveIds.length,
    selectedActiveIds,
    selectedMissingIds,
    selectedTranslatedIds,
    selectedIds,
    setBatchRangeFrom,
    setBatchRangeTo,
    setDeleteAllTranslationsOpen,
    setDeleteChapterId,
    setDeleteNovelOpen,
    setLogChapterId,
    setRetranslateChapterId,
    setReorderOpen,
    setSelectedIds,
    setStopSelectedOpen,
    startTranslate,
    stopSelectedOpen,
    readyUnpublishedCount,
    unreadyCount,
    logChapterId,
    selectByRange,
    retranslateChapterId,
  };
}
