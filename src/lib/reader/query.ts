import { queryOptions } from "@tanstack/react-query";

import { getReaderBookmarks, getReaderNovelState } from "@/lib/reader/reader.functions";
import type { ReaderBookmarkCursor } from "@/lib/reader/types";

// Signed-in reader state lives on the server; callers gate the query on the session.
export const readerStateQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["readerState", novelId],
    queryFn: () => getReaderNovelState({ data: { novelId } }),
    staleTime: 30_000,
  });

export const readerStateQueryKey = (novelId: string) => ["readerState", novelId] as const;

// Continuation pages are keyed by their exact cursor, so a retried request can never
// reuse rows fetched before a bookmark mutation.
export const readerBookmarkPagesQueryKey = (novelId: string) =>
  ["readerBookmarks", novelId] as const;

export const readerBookmarkListQueryKey = (novelId: string) =>
  [...readerBookmarkPagesQueryKey(novelId), "first"] as const;

// The first page is requested only when the bookmark dialog opens, so a novel or chapter
// page never transfers a reader's whole bookmark list just to render progress.
export const readerBookmarkListQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: readerBookmarkListQueryKey(novelId),
    queryFn: () => getReaderBookmarks({ data: { novelId, cursor: null } }),
    staleTime: 30_000,
  });

export const readerBookmarkPageQueryOptions = (novelId: string, cursor: ReaderBookmarkCursor) =>
  queryOptions({
    queryKey: [...readerBookmarkPagesQueryKey(novelId), cursor.createdAt, cursor.id],
    queryFn: () => getReaderBookmarks({ data: { novelId, cursor } }),
    staleTime: 0,
  });
