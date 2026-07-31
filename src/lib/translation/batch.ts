export interface BatchChapter {
  id: string;
}

export interface QueuedBatchChapter {
  chapterId: string;
  jobId: string;
  totalChunks: number;
}

export interface SkippedBatchChapter {
  chapterId: string;
  reason: string;
}

export async function enqueueTranslationBatchInOrder(
  chapters: readonly BatchChapter[],
  enqueue: (chapterId: string) => Promise<{ jobId: string; totalChunks: number }>,
): Promise<{ queued: QueuedBatchChapter[]; skipped: SkippedBatchChapter[] }> {
  const queued: QueuedBatchChapter[] = [];
  const skipped: SkippedBatchChapter[] = [];

  await chapters.reduce(
    (sequence, chapter) =>
      sequence.then(async () => {
        try {
          const result = await enqueue(chapter.id);
          queued.push({ chapterId: chapter.id, ...result });
        } catch (error) {
          skipped.push({
            chapterId: chapter.id,
            reason: error instanceof Error ? error.message : "Failed to start translation",
          });
        }
      }),
    Promise.resolve(),
  );

  return { queued, skipped };
}
