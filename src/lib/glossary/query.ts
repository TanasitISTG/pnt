import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { getGlossaryStats, listGlossaryTerms } from "@/lib/glossary/functions";
import type { GlossaryListSearch } from "@/lib/glossary/schemas";

export const glossaryStatsQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["glossaryStats", novelId] as const,
    queryFn: () => getGlossaryStats({ data: { novelId } }),
  });

export const glossaryTermsQueryOptions = (novelId: string, search: GlossaryListSearch) =>
  queryOptions({
    queryKey: ["glossaryTerms", novelId, search] as const,
    queryFn: () => listGlossaryTerms({ data: { novelId, ...search } }),
    placeholderData: keepPreviousData,
  });
