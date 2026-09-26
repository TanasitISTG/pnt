import { queryOptions } from "@tanstack/react-query";

import { getReaderBookmarks, getReaderNovelState } from "@/lib/reader/reader.functions";
import type { ReaderBookmarkCursor } from "@pnt/contracts/reader";

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

export const readerBookmarkPageQueryOptions = (novelId: string, cursor: ReaderBookmarkCursor) =>
  queryOptions({
    queryKey: [...readerBookmarkPagesQueryKey(novelId), cursor.createdAt, cursor.id],
    queryFn: () => getReaderBookmarks({ data: { novelId, cursor } }),
    staleTime: 0,
  });
