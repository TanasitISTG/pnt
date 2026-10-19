import { queryOptions } from "@tanstack/react-query";

import { getReaderNovel } from "@/lib/content/novel/novel.functions";

export const readerNovelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["readerNovel", novelId],
    queryFn: () => getReaderNovel({ data: { novelId } }),
    staleTime: 10_000,
  });
