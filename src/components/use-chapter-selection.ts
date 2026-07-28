import { useState } from "react";
import { toast } from "sonner";
import type { ChapterRow } from "@/components/chapter-table";
import type { ActiveJobState } from "@/lib/translation/translation.types";

export function useChapterSelection(
  chapters: ChapterRow[],
  activeJobs: Map<string, ActiveJobState>,
  startBatchTranslate: (chapterIds: string[]) => Promise<number>,
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchRangeFrom, setBatchRangeFrom] = useState("");
  const [batchRangeTo, setBatchRangeTo] = useState("");

  const isRowTranslating = (chapterId: string, status: string) => {
    const job = activeJobs.get(chapterId);
    return (
      job?.status === "running" ||
      job?.status === "pending" ||
      status === "translating" ||
      status === "queued"
    );
  };

  const selectableIds = chapters.flatMap((c) => (isRowTranslating(c.id, c.status) ? [] : [c.id]));
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelect = (id: string, checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleSelectAll = (checked: boolean) =>
    setSelectedIds(checked ? new Set(selectableIds) : new Set());

  const selectByRange = () => {
    const from = Number(batchRangeFrom);
    const to = Number(batchRangeTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || from > to) {
      toast.error("Enter a valid range (from ≥ 1, from ≤ to)");
      return;
    }
    const inRange = chapters.filter((c) => {
      const num = Number(c.number);
      return num >= from && num <= to && !isRowTranslating(c.id, c.status);
    });
    if (inRange.length === 0) {
      toast.info("No eligible chapters in that range");
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of inRange) next.add(c.id);
      return next;
    });
    toast.info(`Selected ${inRange.length} chapter(s) in range ${from}–${to}`);
  };

  const handleBatchTranslate = async () => {
    setBatchStarting(true);
    try {
      const count = await startBatchTranslate([...selectedIds]);
      if (count > 0) setSelectedIds(new Set());
    } finally {
      setBatchStarting(false);
    }
  };

  return {
    selectedIds,
    setSelectedIds,
    selectableIds,
    allSelected,
    toggleSelect,
    toggleSelectAll,
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
