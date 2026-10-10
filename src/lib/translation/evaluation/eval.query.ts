import { queryOptions } from "@tanstack/react-query";

import {
  getTranslationEvalReport,
  listTranslationEvalReports,
} from "@/lib/translation/evaluation/eval.functions";
import type { EvalReviewSearch } from "@/lib/translation/evaluation/eval.schemas";

function isActive(status: string | undefined): boolean {
  return status === "pending" || status === "running";
}

export const translationEvalReportsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["translation-eval-reports", novelId] as const,
    queryFn: () => listTranslationEvalReports({ data: { novelId } }),
    refetchInterval: (query) => (isActive(query.state.data?.[0]?.status) ? 3000 : false),
  });

export const translationEvalReportQueryOptions = (
  novelId: string,
  search: EvalReviewSearch,
  enabled = true,
) =>
  queryOptions({
    queryKey: [
      "translation-eval-report",
      novelId,
      search.reviewReport,
      search.reviewFilter,
      search.reviewPage,
      search.reviewPageSize,
    ] as const,
    queryFn: () => {
      if (!search.reviewReport) throw new Error("Quality report not found");
      return getTranslationEvalReport({
        data: {
          novelId,
          reportId: search.reviewReport,
          filter: search.reviewFilter,
          page: search.reviewPage,
          pageSize: search.reviewPageSize,
        },
      });
    },
    enabled: enabled && Boolean(search.reviewReport),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === novelId &&
      previousQuery.queryKey[2] === search.reviewReport &&
      previousQuery.queryKey[3] === search.reviewFilter &&
      previousQuery.queryKey[5] === search.reviewPageSize
        ? previousData
        : undefined,
    refetchInterval: (query) =>
      enabled && search.reviewReport && isActive(query.state.data?.report.status) ? 3000 : false,
  });
