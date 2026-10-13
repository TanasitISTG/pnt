import { infiniteQueryOptions } from "@tanstack/react-query";

import { listChapterComments } from "./functions";

/**
 * One chapter's discussion, paged with "Load more". The pages accumulate in the cache
 * entry so a reader who has expanded a long thread keeps it while the chapter is open;
 * posting a comment invalidates the key and the server's ordering reasserts itself.
 */
export const chapterCommentsQueryOptions = (chapterId: string) =>
  infiniteQueryOptions({
    queryKey: ["chapterComments", chapterId] as const,
    queryFn: ({ pageParam }) => listChapterComments({ data: { chapterId, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    staleTime: 15_000,
  });
