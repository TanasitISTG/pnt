import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { getMyReview, getNovelRating, listNovelReviews } from "./functions";

/** The score beside the novel title. Fetched separately from the novel payload. */
export const novelRatingQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novelRating", novelId] as const,
    queryFn: () => getNovelRating({ data: { novelId } }),
    staleTime: 30_000,
  });

/** The review list, paged with "Load more" so a popular novel stays cheap to open. */
export const novelReviewsQueryOptions = (novelId: string) =>
  infiniteQueryOptions({
    queryKey: ["novelReviews", novelId] as const,
    queryFn: ({ pageParam }) => listNovelReviews({ data: { novelId, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    staleTime: 30_000,
  });

/** The viewer's own review, pinned above the list and editable in place. */
export const myReviewQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["myReview", novelId] as const,
    queryFn: () => getMyReview({ data: { novelId } }),
    staleTime: 30_000,
  });
