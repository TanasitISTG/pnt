import { useMemo } from "react";

import type { ReaderStateApi } from "@/lib/reader/use-reader-state";

/** The only fields a reading-progress join needs from a chapter row. */
export interface ReadingProgressChapter {
  id: string;
  number: string;
  title: string;
  translatedTitle: string | null;
}

export interface NovelReadingProgress<T extends ReadingProgressChapter = ReadingProgressChapter> {
  /** Chapter ids the viewer has finished, for read markers in a chapter list. */
  readChapterIdSet: ReadonlySet<string>;
  /** The chapter the viewer was last in, when it still exists in the list. */
  lastReadChapter: T | null;
  firstChapter: T | null;
  readCount: number;
  totalCount: number;
  percent: number;
  /** False while the stored reader state is still being read. */
  ready: boolean;
}

/**
 * The read-state join a novel page needs: which chapters are read, where the viewer left
 * off, and how far through the novel that is.
 *
 * It takes the chapters and the reader state as inputs rather than fetching either, so
 * the reading page and the studio share one definition while each keeps its own queries —
 * and so a guest (whose state is local storage) gets the same numbers as an account.
 */
export function useNovelReadingProgress<T extends ReadingProgressChapter>(
  chapters: readonly T[],
  readerState: ReaderStateApi,
): NovelReadingProgress<T> {
  const readerProgress = readerState.progress;
  const readChapterIdSet = useMemo(
    () => new Set(readerProgress.readChapterIds),
    [readerProgress.readChapterIds],
  );
  const lastReadChapter = useMemo(() => {
    if (!readerProgress.lastChapterId) return null;
    return chapters.find((chapter) => chapter.id === readerProgress.lastChapterId) ?? null;
  }, [chapters, readerProgress.lastChapterId]);
  const progress = useMemo(() => {
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

  return {
    readChapterIdSet,
    lastReadChapter,
    firstChapter: chapters[0] ?? null,
    ...progress,
    ready: readerState.ready,
  };
}
