import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import {
  getMyNovelReport,
  getReportQueueCounts,
  listDecidedReports,
  listReportCaseQueue,
} from "@/lib/reports/functions";
import type { ReportQueueSearch } from "@/lib/reports/schemas";

/**
 * The reporter's own open report on a novel. It decides whether the novel page offers a
 * Report control or says "Reported", so it is fetched only for a signed-in reader.
 */
export const myNovelReportQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novelReport", novelId] as const,
    queryFn: () => getMyNovelReport({ data: { novelId } }),
    staleTime: 30_000,
  });

/**
 * The open queue and the decided list. Search and paging are part of the key, so each
 * view keeps its own cache entry, and `keepPreviousData` avoids a blank table while the
 * next page arrives.
 */
export const reportCaseQueueQueryOptions = (search: ReportQueueSearch) =>
  queryOptions({
    queryKey: ["reportQueue", "open", search] as const,
    queryFn: () => listReportCaseQueue({ data: search }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

export const reportHistoryQueryOptions = (search: ReportQueueSearch) =>
  queryOptions({
    queryKey: ["reportQueue", "history", search] as const,
    queryFn: () => listDecidedReports({ data: search }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });

/** The open-case count behind the operator tab, so the queue is visible before opening it. */
export const reportQueueCountsQueryOptions = () =>
  queryOptions({
    queryKey: ["reportQueue", "counts"] as const,
    queryFn: () => getReportQueueCounts(),
    staleTime: 30_000,
  });
