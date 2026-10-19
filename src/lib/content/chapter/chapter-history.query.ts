import { queryOptions } from "@tanstack/react-query";

import {
  getChapterTranslationVersion,
  listChapterTranslationVersions,
} from "./chapter-history.functions";

/**
 * The list is metadata and is cheap; the body of one version is fetched only when that
 * version is selected, which is why it has an entry of its own instead of riding along.
 */
export const chapterHistoryQueryOptions = (chapterId: string, enabled = true) =>
  queryOptions({
    queryKey: ["chapterHistory", chapterId] as const,
    queryFn: () => listChapterTranslationVersions({ data: { chapterId } }),
    enabled,
    staleTime: 15_000,
  });

export const chapterVersionQueryOptions = (versionId: string | null) =>
  queryOptions({
    queryKey: ["chapterVersion", versionId] as const,
    queryFn: () => getChapterTranslationVersion({ data: { versionId: versionId ?? "" } }),
    enabled: versionId !== null,
    // A version is immutable: once fetched, it is the same text for as long as the app runs.
    staleTime: Infinity,
  });
