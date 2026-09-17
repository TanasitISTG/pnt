import { queryOptions, type QueryClient } from "@tanstack/react-query";

import type { AdminNovelDetailCore } from "@/lib/content/novel/admin-novel-detail.service";
import { chaptersQueryOptions } from "@/lib/content/chapter/chapter.query";
import { getAdminNovelDetailMetrics, getNovel } from "@/lib/content/novel/novel.functions";

export const novelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId] as const,
    queryFn: () => getNovel({ data: { novelId } }),
    staleTime: 10_000,
  });

export const adminNovelDetailMetricsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["adminNovelDetailMetrics", novelId] as const,
    queryFn: () => getAdminNovelDetailMetrics({ data: { novelId } }),
    staleTime: 5_000,
  });

export function hydrateAdminNovelDetailCore(
  queryClient: QueryClient,
  core: AdminNovelDetailCore,
): void {
  queryClient.setQueryData(novelQueryOptions(core.novel.id).queryKey, core.novel);
  queryClient.setQueryData(chaptersQueryOptions(core.novel.id).queryKey, core.chapters);
}
