import { queryOptions } from "@tanstack/react-query";

import { getReaderNovelState } from "@/lib/reader/reader.functions";

// Signed-in reader state lives on the server; callers gate the query on the session.
export const readerStateQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["readerState", novelId],
    queryFn: () => getReaderNovelState({ data: { novelId } }),
    staleTime: 30_000,
  });

export const readerStateQueryKey = (novelId: string) => ["readerState", novelId] as const;
