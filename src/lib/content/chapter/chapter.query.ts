import { queryOptions, type QueryClient } from "@tanstack/react-query";

import {
  getChapter,
  getReaderChapterManifest,
  listChapters,
  type ReaderChapterRow,
} from "@/lib/content/chapter/chapter.functions";

export const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId] as const,
    queryFn: () => listChapters({ data: { novelId } }),
    staleTime: 10_000,
  });

// The reading list on the novel page and the reader's own chapter picker share this
// four-field manifest. It is deliberately not `listChapters`: a reader never needs the
// studio's status, counts, timestamps, or per-chapter history probe.
export const readerChapterManifestQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["readerChapterManifest", novelId] as const,
    queryFn: () => getReaderChapterManifest({ data: { novelId } }),
    staleTime: 10_000,
  });

/** Seed the manifest from the owner's already-loaded studio rows, with no extra request. */
export function hydrateReaderChapterManifest(
  queryClient: QueryClient,
  novelId: string,
  chapters: readonly ReaderChapterRow[],
): void {
  queryClient.setQueryData(
    readerChapterManifestQueryOptions(novelId).queryKey,
    chapters.map(({ id, number, title, translatedTitle }) => ({
      id,
      number,
      title,
      translatedTitle,
    })),
  );
}

export const chapterQueryOptions = (chapterId: string, novelId: string) =>
  queryOptions({
    queryKey: ["chapter", chapterId] as const,
    queryFn: () => getChapter({ data: { chapterId } }),
    staleTime: 10_000,
    meta: { novelId },
  });

export function invalidateNovelChapterDetails(
  queryClient: QueryClient,
  novelId: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: ["chapter"],
    predicate: (query) => {
      if (query.meta?.novelId === novelId) return true;
      const data: unknown = query.state.data;
      if (typeof data !== "object" || data === null || !("novelId" in data)) return false;
      return data.novelId === novelId;
    },
  });
}
