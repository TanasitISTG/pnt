// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ActiveJobState } from "@/lib/translation/types/api";
import type { ChapterRow } from "./types";
import { useChapterSelection } from "./use-chapter-selection";

const chapters: ChapterRow[] = [
  {
    id: "idle-1",
    number: "1",
    title: "Idle one",
    translatedTitle: null,
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
    status: "translating",
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
  it("partitions queue and stop actions while retaining skipped and idle selection", async () => {
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

    expect(result.current.selectedTranslatableIds).toEqual(["idle-1", "idle-2"]);
    expect(result.current.selectedActiveIds).toEqual(["active-1", "active-2"]);

    await act(async () => {
      await result.current.handleBatchTranslate();
    });

    expect(startBatchTranslate).toHaveBeenCalledWith(["idle-1", "idle-2"]);
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
