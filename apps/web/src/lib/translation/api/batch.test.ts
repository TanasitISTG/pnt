import { describe, expect, it, vi } from "vitest";
import { enqueueTranslationBatchInOrder } from "./batch";

describe("enqueueTranslationBatchInOrder", () => {
  it("does not start the next chapter until the prior enqueue settles", async () => {
    const events: string[] = [];
    const enqueue = vi.fn(async (chapterId: string) => {
      events.push(`start:${chapterId}`);
      await Promise.resolve();
      events.push(`finish:${chapterId}`);
      return { jobId: `job-${chapterId}`, totalChunks: 1 };
    });

    const result = await enqueueTranslationBatchInOrder(
      [{ id: "chapter-10" }, { id: "chapter-11" }, { id: "chapter-12" }],
      enqueue,
    );

    expect(events).toEqual([
      "start:chapter-10",
      "finish:chapter-10",
      "start:chapter-11",
      "finish:chapter-11",
      "start:chapter-12",
      "finish:chapter-12",
    ]);
    expect(result.queued.map((item) => item.chapterId)).toEqual([
      "chapter-10",
      "chapter-11",
      "chapter-12",
    ]);
  });

  it("records a failed chapter and continues in order", async () => {
    const result = await enqueueTranslationBatchInOrder(
      [{ id: "chapter-1" }, { id: "chapter-2" }],
      async (chapterId) => {
        if (chapterId === "chapter-1") throw new Error("empty chapter");
        return { jobId: "job-2", totalChunks: 2 };
      },
    );

    expect(result).toEqual({
      queued: [{ chapterId: "chapter-2", jobId: "job-2", totalChunks: 2 }],
      skipped: [{ chapterId: "chapter-1", reason: "empty chapter" }],
    });
  });
});
