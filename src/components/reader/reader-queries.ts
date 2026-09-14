import { queryOptions } from "@tanstack/react-query";

import { getChapter, getReaderChapterManifest } from "@/lib/content/chapter.functions";
import { getReaderNovel } from "@/lib/content/novel.functions";

export const chapterQueryOptions = (chapterId: string) =>
  queryOptions({
    queryKey: ["chapter", chapterId],
    queryFn: () => getChapter({ data: { chapterId } }),
    staleTime: 10_000,
  });

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
