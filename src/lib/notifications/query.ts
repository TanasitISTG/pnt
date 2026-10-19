import { queryOptions } from "@tanstack/react-query";

import { getNovelFollow, listNotifications } from "./functions";

/**
 * One key for the whole bell: every mutation invalidates it and every realtime message
 * invalidates it, so there is no per-account or per-filter variant to keep in step.
 *
 * The poll is the guarantee, not a workaround: Ably is asked to deliver the same news
 * sooner, and a deployment without a key (dev, CI, E2E) runs this path alone.
 */
export const notificationKeys = {
  all: ["notifications"] as const,
};

export const notificationsQueryOptions = () =>
  queryOptions({
    queryKey: notificationKeys.all,
    queryFn: () => listNotifications(),
    staleTime: 15_000,
    // Ably is the instant path and the poll is the correctness fallback. A minute keeps
    // the bell fresh without asking the database every thirty seconds per open tab.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

export const novelFollowQueryKey = (novelId: string) => ["novelFollow", novelId] as const;

export const novelFollowQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: novelFollowQueryKey(novelId),
    queryFn: () => getNovelFollow({ data: { novelId } }),
    staleTime: 30_000,
  });
