import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ChapterRow } from "@/components/chapters/types";
import type { ActiveJobState } from "@/lib/translation/types/api";

export function useChapterSelection(
  chapters: ChapterRow[],
  activeJobs: Map<string, ActiveJobState>,
  startBatchTranslate: (chapterIds: string[]) => Promise<number>,
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchStarting, setBatchStarting] = useState(false);
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

  const selectableIds = useMemo(
    () =>
      chapters.flatMap((chapter) =>
        isRowTranslating(chapter.id, chapter.status) ? [] : [chapter.id],
      ),
    [chapters, isRowTranslating],
  );

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
      return num >= from && num <= to && !isRowTranslating(chapter.id, chapter.status);
    });
    if (inRange.length === 0) {
      toast.info("No eligible chapters in that range");
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const chapter of inRange) next.add(chapter.id);
      return next;
    });
    toast.info(`Selected ${inRange.length} chapter(s) in range ${from}–${to}`);
  }, [batchRangeFrom, batchRangeTo, chapters, isRowTranslating]);

  const handleBatchTranslate = useCallback(async () => {
    setBatchStarting(true);
    try {
      const count = await startBatchTranslate([...selectedIds]);
      if (count > 0) setSelectedIds(new Set());
    } finally {
      setBatchStarting(false);
    }
  }, [selectedIds, startBatchTranslate]);

  return {
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
  };
}
