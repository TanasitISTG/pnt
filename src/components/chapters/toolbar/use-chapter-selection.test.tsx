// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActiveJobState } from "@/lib/translation/types/api";
import type { ChapterRow } from "@/components/chapters/types";
import { useChapterSelection } from "./use-chapter-selection";

const chapters: ChapterRow[] = [
  {
    id: "idle-1",
    number: "1",
    title: "Idle one",
    translatedTitle: null,
    hasTranslation: false,
    status: "raw",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
  {
    id: "active-1",
    number: "2",
    title: "Active one",
    translatedTitle: null,
    hasTranslation: false,
    status: "queued",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
  {
    id: "idle-2",
    number: "3",
    title: "Idle two",
    translatedTitle: null,
    hasTranslation: false,
    status: "raw",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
  {
    id: "active-2",
    number: "4",
    title: "Active two",
    translatedTitle: null,
    hasTranslation: false,
    status: "translating",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
  {
    id: "translated-1",
    number: "5",
    title: "Translated one",
    translatedTitle: "Translated one",
    hasTranslation: true,
    status: "translated",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
];

const activeJobs = new Map<string, ActiveJobState>([
  [
    "active-1",
    { jobId: "job-1", chapterId: "active-1", status: "running", doneChunks: 1, totalChunks: 2 },
  ],
  [
    "active-2",
    { jobId: "job-2", chapterId: "active-2", status: "pending", doneChunks: 0, totalChunks: 2 },
  ],
]);

describe("useChapterSelection", () => {
  it("partitions missing, translated, and active actions", async () => {
    const startBatchTranslate = vi.fn().mockResolvedValue(2);
    const cancelMany = vi.fn().mockResolvedValue({
      cancelledChapterIds: ["active-1"],
      skippedChapterIds: ["active-2"],
    });
    const { result } = renderHook(() =>
      useChapterSelection(chapters, activeJobs, startBatchTranslate, cancelMany),
    );

    act(() => {
      for (const chapter of chapters) result.current.toggleSelect(chapter.id, true);
    });

    expect(result.current.selectedMissingIds).toEqual(["idle-1", "idle-2"]);
    expect(result.current.selectedTranslatedIds).toEqual(["translated-1"]);
    expect(result.current.selectedActiveIds).toEqual(["active-1", "active-2"]);

    await act(async () => {
      await result.current.handleBatchTranslate();
    });

    expect(startBatchTranslate).toHaveBeenCalledWith(["idle-1", "idle-2"], "missing");
    expect(result.current.selectedIds).toEqual(new Set(["active-1", "active-2", "translated-1"]));

    await act(async () => {
      await result.current.handleBatchRetranslate();
    });

    expect(startBatchTranslate).toHaveBeenLastCalledWith(["translated-1"], "overwrite");
    expect(result.current.selectedIds).toEqual(new Set(["active-1", "active-2"]));

    act(() => result.current.toggleSelect("idle-2", true));
    let stopped = false;
    await act(async () => {
      stopped = await result.current.handleBatchStop();
    });

    expect(stopped).toBe(true);
    expect(cancelMany).toHaveBeenCalledWith(["active-1", "active-2"]);
    expect(result.current.selectedIds).toEqual(new Set(["idle-2", "active-2"]));
  });
});
