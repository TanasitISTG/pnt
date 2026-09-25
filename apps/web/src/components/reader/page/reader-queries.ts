import { queryOptions } from "@tanstack/react-query";

import { getReaderChapterManifest } from "@/lib/content/chapter/chapter.functions";
import { getReaderNovel } from "@/lib/content/novel/novel.functions";

export const readerChapterManifestQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["readerChapterManifest", novelId],
    queryFn: () => getReaderChapterManifest({ data: { novelId } }),
    staleTime: 10_000,
  });
export const readerNovelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["readerNovel", novelId],
    queryFn: () => getReaderNovel({ data: { novelId } }),
    staleTime: 10_000,
  });
