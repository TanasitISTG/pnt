import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ChapterRow } from "@/components/chapters/types";
import type { ActiveJobState } from "@/lib/translation/types/api";

export function useChapterSelection(
  chapters: ChapterRow[],
  activeJobs: Map<string, ActiveJobState>,
  startBatchTranslate: (chapterIds: string[]) => Promise<number>,
  cancelMany: (
    chapterIds: string[],
  ) => Promise<{ cancelledChapterIds: string[]; skippedChapterIds: string[] } | null>,
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchStopping, setBatchStopping] = useState(false);
  const [batchRangeFrom, setBatchRangeFrom] = useState("");
  const [batchRangeTo, setBatchRangeTo] = useState("");

  const isRowTranslating = useCallback(
    (chapterId: string, status: string) => {
      const job = activeJobs.get(chapterId);
      return (
        job?.status === "running" ||
        job?.status === "pending" ||
        status === "translating" ||
        status === "queued"
      );
    },
    [activeJobs],
  );

  const selectableIds = useMemo(() => chapters.map((chapter) => chapter.id), [chapters]);
  const { selectedTranslatableIds, selectedActiveIds } = useMemo(() => {
    const translatableIds: string[] = [];
    const activeIds: string[] = [];

    for (const chapter of chapters) {
      if (!selectedIds.has(chapter.id)) continue;
      if (isRowTranslating(chapter.id, chapter.status)) {
        activeIds.push(chapter.id);
      } else {
        translatableIds.push(chapter.id);
      }
    }

    return { selectedTranslatableIds: translatableIds, selectedActiveIds: activeIds };
  }, [chapters, isRowTranslating, selectedIds]);

  const toggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectMany = useCallback((chapterIds: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const chapterId of chapterIds) {
        if (checked) next.add(chapterId);
        else next.delete(chapterId);
      }
      return next;
    });
  }, []);

  const selectByRange = useCallback(() => {
    const from = Number(batchRangeFrom);
    const to = Number(batchRangeTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || from > to) {
      toast.error("Enter a valid range (from ≥ 1, from ≤ to)");
      return;
    }
    const inRange = chapters.filter((chapter) => {
      const num = Number(chapter.number);
      return num >= from && num <= to;
    });
    if (inRange.length === 0) {
      toast.info("No chapters in that range");
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const chapter of inRange) next.add(chapter.id);
      return next;
    });
    toast.info(`Selected ${inRange.length} chapter(s) in range ${from}–${to}`);
  }, [batchRangeFrom, batchRangeTo, chapters]);

  const handleBatchTranslate = useCallback(async () => {
    if (selectedTranslatableIds.length === 0) return;
    setBatchStarting(true);
    try {
      const count = await startBatchTranslate(selectedTranslatableIds);
      if (count > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const chapterId of selectedTranslatableIds) next.delete(chapterId);
          return next;
        });
      }
    } finally {
      setBatchStarting(false);
    }
  }, [selectedTranslatableIds, startBatchTranslate]);

  const handleBatchStop = useCallback(async () => {
    if (selectedActiveIds.length === 0) return true;
    setBatchStopping(true);
    try {
      const result = await cancelMany(selectedActiveIds);
      if (!result) return false;

      const cancelledIds = new Set(result.cancelledChapterIds);
      if (cancelledIds.size > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const chapterId of cancelledIds) next.delete(chapterId);
          return next;
        });
      }
      return true;
    } finally {
      setBatchStopping(false);
    }
  }, [cancelMany, selectedActiveIds]);

  return {
    selectedIds,
    setSelectedIds,
    selectableIds,
    selectedTranslatableIds,
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
    handleBatchStop,
    isRowTranslating,
  };
}
