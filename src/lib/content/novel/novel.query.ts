import { queryOptions, type QueryClient } from "@tanstack/react-query";

import type { AdminNovelDetailCore } from "@/lib/content/novel/admin-novel-detail.service";
import { chaptersQueryOptions } from "@/lib/content/chapter/chapter.query";
import { getResidualScriptChapters } from "@/lib/content/chapter/chapter-ops.functions";
import { getAdminNovelDetailMetrics, getNovel } from "@/lib/content/novel/novel.functions";
import { getChapterPublicationReadiness } from "@/lib/content/publish/readiness.functions";

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
    staleTime: 60_000,
  });

// The residual scan reads every translated chapter body, so it is keyed by a
// content revision and only re-runs when the content or approved glossary moves.
export const adminNovelResidualQueryOptions = (novelId: string, revision: string) =>
  queryOptions({
    queryKey: ["adminNovelResidual", novelId, revision] as const,
    queryFn: () => getResidualScriptChapters({ data: { novelId } }),
    staleTime: 5 * 60_000,
  });

// The publish pre-flight counts paragraphs over every translated body and joins the runs
// behind them, so it is keyed by a content revision for the same reason the residual scan is:
// a cached verdict may only be reused while nothing it read has moved.
export const publicationReadinessQueryOptions = (novelId: string, revision: string) =>
  queryOptions({
    queryKey: ["publicationReadiness", novelId, revision] as const,
    queryFn: () => getChapterPublicationReadiness({ data: { novelId } }),
    staleTime: 5 * 60_000,
  });

export function hydrateAdminNovelDetailCore(
  queryClient: QueryClient,
  core: AdminNovelDetailCore,
): void {
  queryClient.setQueryData(novelQueryOptions(core.novel.id).queryKey, core.novel);
  queryClient.setQueryData(chaptersQueryOptions(core.novel.id).queryKey, core.chapters);
}
