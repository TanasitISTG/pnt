import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import type { ChapterTableProps } from "@/components/chapters/table/chapter-table";
import { useChapterTitleEdit } from "@/components/chapters/table/use-chapter-title-edit";
import { useChapterSelection } from "@/components/chapters/toolbar/use-chapter-selection";
import type { NovelDetailDialogData } from "@/components/novels/detail/novel-detail-dialogs";
import type { NovelDetailSectionData } from "@/components/novels/detail/novel-detail-sections";
import { useNovelDetailMutations } from "@/components/novels/detail/use-novel-detail-mutations";
import { useNovelExport } from "@/components/novels/detail/use-novel-export";
import type { NovelHeaderProps } from "@/components/novels/detail/novel-header";
import { useTranslationJob } from "@/components/translation/job/use-translation-job";
import { chaptersQueryOptions } from "@/lib/content/chapter/chapter.query";
import {
  adminNovelDetailMetricsQueryOptions,
  novelQueryOptions,
} from "@/lib/content/novel/novel.query";
import { useReaderState } from "@/lib/reader/use-reader-state";

let currentTimeSnapshot = 0;
const clockSubscribers = new Set<{
  notify: () => void;
  boundaries: readonly number[];
}>();
let clockTimer: NodeJS.Timeout | undefined;

function updateClockSnapshot() {
  currentTimeSnapshot = Date.now();
  for (const subscriber of clockSubscribers) subscriber.notify();
  scheduleClockUpdate();
}

function scheduleClockUpdate() {
  clearTimeout(clockTimer);
  clockTimer = undefined;
  let nextBoundary = Infinity;
  for (const subscriber of clockSubscribers) {
    for (const boundary of subscriber.boundaries) {
      if (boundary > currentTimeSnapshot && boundary < nextBoundary) {
        nextBoundary = boundary;
      }
    }
  }
  if (nextBoundary !== Infinity) {
    clockTimer = setTimeout(updateClockSnapshot, nextBoundary - currentTimeSnapshot);
  }
}

function subscribeToClock(notify: () => void, boundaries: readonly number[]): () => void {
  const subscriber = { notify, boundaries };
  clockSubscribers.add(subscriber);
  currentTimeSnapshot = Date.now();
  notify();
  scheduleClockUpdate();
  return () => {
    clockSubscribers.delete(subscriber);
    scheduleClockUpdate();
  };
}

function getClockSnapshot() {
  return currentTimeSnapshot;
}

function getServerClockSnapshot() {
  return 0;
}

const EMPTY_CHAPTERS: never[] = [];
const EMPTY_RESIDUAL_SCRIPTS: never[] = [];

export interface NovelDetailLoadState {
  novel: NovelHeaderProps["novel"] | null | undefined;
  isNovelError: boolean;
  novelError: unknown;
  isChaptersError: boolean;
  chaptersError: unknown;
  refetchNovel: () => Promise<unknown>;
  refetchChapters: () => Promise<unknown>;
}

export interface NovelDetailPageResult {
  loadState: NovelDetailLoadState;
  sectionProps: NovelDetailSectionData;
  tableProps: Omit<ChapterTableProps, "chapters">;
  dialogProps: NovelDetailDialogData;
}

export function useNovelDetailPage(novelId: string, isAdmin: boolean): NovelDetailPageResult {
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

  const readerState = useReaderState(novelId, isAdmin);
  const readerProgress = readerState.progress;
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
  const readingActionsPending = chaptersQuery.isPending || !readerState.ready;
  const chapterUiLoading = isAdmin && readingActionsPending;
  const readingProgress = useMemo(() => {
    const totalCount = chapters.length;
    const readCount = chapters.reduce(
      (count, chapter) => (readChapterIdSet.has(chapter.id) ? count + 1 : count),
      0,
    );
    return {
      readCount,
      totalCount,
      percent: totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0,
    };
  }, [chapters, readChapterIdSet]);

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

  const { editState, setEditState, handleStartEdit, handleSaveTitle } =
    useChapterTitleEdit(novelId);
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

  const publicationBoundaries = useMemo(() => {
    const boundaries: number[] = [];
    for (const chapter of chapters) {
      if (chapter.status === "translated" && chapter.hasTranslation && chapter.publishedAt) {
        const boundary = new Date(chapter.publishedAt).getTime();
        if (Number.isFinite(boundary)) boundaries.push(boundary);
      }
    }
    return boundaries;
  }, [chapters]);
  const subscribeToRelevantClock = useCallback(
    (notify: () => void) => subscribeToClock(notify, publicationBoundaries),
    [publicationBoundaries],
  );
  const now = useSyncExternalStore(
    subscribeToRelevantClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );
  const { readyUnpublishedCount, unreadyCount } = useMemo(() => {
    let readyCount = 0;
    let unreadyChapterCount = 0;
    for (const chapter of chapters) {
      const ready = chapter.status === "translated" && chapter.hasTranslation;
      if (!ready) {
        unreadyChapterCount++;
      } else if (!chapter.publishedAt || new Date(chapter.publishedAt).getTime() > now) {
        readyCount++;
      }
    }
    return { readyUnpublishedCount: readyCount, unreadyCount: unreadyChapterCount };
  }, [chapters, now]);

  const { exporting, handleExportTxt, handleExportEpub } = useNovelExport(novelId);

  const tableProps: Omit<ChapterTableProps, "chapters"> = {
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
    onSaveTitle: handleSaveTitle,
    onStartEdit: handleStartEdit,
    onCancelEdit: handleCancelEdit,
    onDeleteChapter: setDeleteChapterId,
  };

  const loadState: NovelDetailLoadState = {
    novel: novelQuery.data,
    isNovelError: novelQuery.isError,
    novelError: novelQuery.error,
    isChaptersError: chaptersQuery.isError,
    chaptersError: chaptersQuery.error,
    refetchNovel: novelQuery.refetch,
    refetchChapters: chaptersQuery.refetch,
  };

  const sectionProps: NovelDetailSectionData = {
    header: {
      glossaryStats: metrics?.glossaryStats,
      costData: metrics?.costData,
      chapters,
      chaptersPending: chapterUiLoading,
      readingActionsPending,
      lastReadChapter,
      firstChapter,
      readingProgress,
      readyUnpublishedCount,
      unreadyCount,
      exporting,
      publishingNovel,
      onPublishNovel: publishNovel,
      onExportTxt: handleExportTxt,
      onExportEpub: handleExportEpub,
      onDeleteNovel: () => setDeleteNovelOpen(true),
    },
    chapterPanel: {
      chapters,
      chapterUiLoading,
      isChaptersPending: chaptersQuery.isPending,
      lastReadChapter,
      selectedIds,
      selectedMissingIds,
      selectedTranslatedIds,
      selectedActiveIds,
      selectableIds,
      batchStarting,
      batchStopping,
      handleBatchTranslate,
      onRequestBatchRetranslate: () => setBatchRetranslateOpen(true),
      activeJobsError,
      refetchActiveJobs,
      setSelectedIds,
      setStopSelectedOpen,
      selectByRange,
      readyUnpublishedCount,
      unreadyCount,
      publishAllChapters,
      publishingAll,
      missingTitleCount,
      backfillTitles,
      backfillingTitles,
      setReorderOpen,
      reorderDisabled,
      deletingAllTranslations,
      setDeleteAllTranslationsOpen,
    },
    metrics: {
      error: metricsQuery.error,
      isError: metricsQuery.isError,
      refetch: metricsQuery.refetch,
    },
    chapterTools: {
      ready: chaptersReady,
      invalidateChapters,
    },
  };

  const dialogProps: NovelDetailDialogData = {
    novelId,
    reorder: {
      chapters,
      open: reorderOpen,
      onOpenChange: setReorderOpen,
      onSave: handleSaveChapterOrder,
    },
    deleteNovel: {
      open: deleteNovelOpen,
      onOpenChange: setDeleteNovelOpen,
      onConfirm: removeNovel,
      pending: deletingNovel,
    },
    deleteTranslations: {
      open: deleteAllTranslationsOpen,
      onOpenChange: setDeleteAllTranslationsOpen,
      onConfirm: deleteAllTranslations,
      pending: deletingAllTranslations,
    },
    deleteChapter: {
      chapterId: deleteChapterId,
      setChapterId: setDeleteChapterId,
      remove: removeChapter,
      pending: deletingChapter,
    },
    logs: {
      chapterId: logChapterId,
      setChapterId: setLogChapterId,
    },
    retranslate: {
      chapterId: retranslateChapterId,
      setChapterId: setRetranslateChapterId,
      start: startTranslate,
    },
    batchRetranslate: {
      chapterIds: selectedTranslatedIds,
      open: batchRetranslateOpen,
      onOpenChange: setBatchRetranslateOpen,
      pending: batchStarting,
      onConfirm: confirmBatchRetranslate,
    },
    stopSelected: {
      count: selectedActiveIds.length,
      open: stopSelectedOpen,
      onOpenChange: setStopSelectedOpen,
      pending: batchStopping,
      onConfirm: confirmStopSelectedTranslations,
    },
  };

  return { loadState, sectionProps, tableProps, dialogProps };
}
