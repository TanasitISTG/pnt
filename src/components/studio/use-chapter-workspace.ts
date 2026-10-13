import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChapterTableProps } from "@/components/chapters/table/chapter-table";
import { useChapterTitleEdit } from "@/components/chapters/table/use-chapter-title-edit";
import { useChapterSelection } from "@/components/chapters/toolbar/use-chapter-selection";
import type { ChapterRow } from "@/components/chapters/types";
import { useNovelReadingProgress } from "@/components/novels/use-novel-reading-progress";
import { useTranslationJob } from "@/components/translation/job/use-translation-job";
import { chaptersQueryOptions } from "@/lib/content/chapter/chapter.query";
import {
  adminNovelDetailMetricsQueryOptions,
  adminNovelResidualQueryOptions,
} from "@/lib/content/novel/novel.query";
import { residualRevisionOf } from "@/lib/content/novel/residual-revision";
import { useReaderState } from "@/lib/reader/use-reader-state";
import type { NovelDetailChapterPanelDetail } from "./studio-chapters";
import type { NovelDetailDialogData } from "./studio-dialogs";
import { useNovelDetailMutations } from "./use-novel-detail-mutations";

/**
 * One clock shared by every "is this chapter publishable yet" question on the page, so a
 * chapter scheduled for later flips its count when its moment arrives instead of on the
 * next unrelated re-render.
 */
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

export interface ChapterWorkspace {
  chapters: ChapterRow[];
  /** Per-chapter usage and the glossary counts, read once for the whole workspace. */
  costData: ChapterTableProps["costData"];
  glossaryStats: { total: number; approved: number; pending: number } | undefined;
  /** Dense rows, bulk actions and the read markers the owner sees as a reader too. */
  chapterPanel: NovelDetailChapterPanelDetail;
  tableProps: Omit<ChapterTableProps, "chapters">;
  dialogProps: NovelDetailDialogData;
  chapterTools: {
    ready: boolean;
    invalidateChapters: () => void;
  };
  metrics: {
    isError: boolean;
    error: unknown;
    refetch: () => Promise<unknown>;
  };
}

/**
 * The chapter workspace: the owner's chapter rows, their selection, the translation jobs
 * running against them, and every mutation the toolbar and row menus reach. It owns the
 * queries only the studio needs — per-chapter cost, residual scripts, the archive of a
 * finished run — while the novel itself comes from the studio layout, which has already
 * established that this viewer may manage it.
 */
export function useChapterWorkspace(novelId: string): ChapterWorkspace {
  const queryClient = useQueryClient();
  const chaptersQuery = useQuery(chaptersQueryOptions(novelId));
  const metricsQuery = useQuery(adminNovelDetailMetricsQueryOptions(novelId));

  const chapters = chaptersQuery.data ?? EMPTY_CHAPTERS;
  const metrics = metricsQuery.data;
  const approvedTermCount = metrics?.glossaryStats.approved ?? 0;
  const residualRevision = useMemo(
    () => residualRevisionOf(chapters, approvedTermCount),
    [chapters, approvedTermCount],
  );
  const residualQuery = useQuery({
    ...adminNovelResidualQueryOptions(novelId, residualRevision),
    enabled: chaptersQuery.isSuccess,
  });
  const residualScriptChapters = residualQuery.data ?? EMPTY_RESIDUAL_SCRIPTS;
  const residualScriptMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of residualScriptChapters) {
      map.set(item.chapterId, item.count);
    }
    return map;
  }, [residualScriptChapters]);

  const readerState = useReaderState(novelId, true);
  const readingProgress = useNovelReadingProgress(chapters, readerState);
  const [retranslateChapterId, setRetranslateChapterId] = useState<string | null>(null);
  const [deleteAllTranslationsOpen, setDeleteAllTranslationsOpen] = useState(false);
  const [logChapterId, setLogChapterId] = useState<string | null>(null);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [stopSelectedOpen, setStopSelectedOpen] = useState(false);
  const [batchRetranslateOpen, setBatchRetranslateOpen] = useState(false);

  const chaptersReady = chaptersQuery.isSuccess && !chaptersQuery.isError;

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
  } = useTranslationJob(novelId, chaptersReady);

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
    removeChapter,
    deletingChapter,
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
    queryClient.invalidateQueries({ queryKey: ["adminNovelResidual", novelId] });
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

  const tableProps: Omit<ChapterTableProps, "chapters"> = {
    novelId,
    isAdmin: true,
    activeJobs,
    readChapterIdSet: readingProgress.readChapterIdSet,
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

  return {
    chapters,
    costData: metrics?.costData,
    glossaryStats: metrics?.glossaryStats,
    chapterPanel: {
      chapters,
      chapterUiLoading: chaptersQuery.isPending || !readerState.ready,
      isChaptersPending: chaptersQuery.isPending,
      lastReadChapter: readingProgress.lastReadChapter,
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
    tableProps,
    dialogProps: {
      novelId,
      reorder: {
        chapters,
        open: reorderOpen,
        onOpenChange: setReorderOpen,
        onSave: handleSaveChapterOrder,
      },
      deleteNovel: {
        open: false,
        onOpenChange: () => {},
        onConfirm: () => {},
        pending: false,
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
    },
    chapterTools: {
      ready: chaptersReady,
      invalidateChapters,
    },
    metrics: {
      error: metricsQuery.error,
      isError: metricsQuery.isError,
      refetch: metricsQuery.refetch,
    },
  };
}
