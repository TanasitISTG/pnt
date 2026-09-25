import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { getChapter, listChapters } from "@/lib/content/chapter/chapter.functions";

export const chaptersQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["chapters", novelId] as const,
    queryFn: () => listChapters({ data: { novelId } }),
    staleTime: 10_000,
  });

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
