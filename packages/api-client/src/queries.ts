import { queryOptions } from "@tanstack/react-query";
import type { ReaderBookmarkCursor } from "@pnt/contracts/reader";
import type { PntApiClient } from "./client";

export type V1Scope = "guest" | (string & {});

export const v1Keys = {
  novels: (scope: V1Scope) => ["v1", scope, "novels"] as const,
  novel: (scope: V1Scope, novelId: string) => ["v1", scope, "novels", novelId] as const,
  chapters: (scope: V1Scope, novelId: string) =>
    ["v1", scope, "novels", novelId, "chapters"] as const,
  manifest: (scope: V1Scope, novelId: string) =>
    ["v1", scope, "novels", novelId, "manifest"] as const,
  chapter: (scope: V1Scope, novelId: string, chapterId: string) =>
    ["v1", scope, "novels", novelId, "chapters", chapterId] as const,
  readerState: (userId: string, novelId: string) =>
    ["v1", accountScope(userId), "novels", novelId, "reader-state"] as const,
  bookmarks: (userId: string, novelId: string, cursor: ReaderBookmarkCursor | null = null) =>
    [
      "v1",
      accountScope(userId),
      "novels",
      novelId,
      "bookmarks",
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
    ] as const,
};

function accountScope(userId: string) {
  if (!userId || userId === "guest") throw new Error("Account queries require a signed-in user ID");
  return userId;
}

export const v1Queries = {
  novels: (client: PntApiClient, scope: V1Scope) =>
    queryOptions({ queryKey: v1Keys.novels(scope), queryFn: () => client.listNovels() }),
  novel: (client: PntApiClient, scope: V1Scope, novelId: string) =>
    queryOptions({
      queryKey: v1Keys.novel(scope, novelId),
      queryFn: () => client.getNovel(novelId),
    }),
  chapters: (client: PntApiClient, scope: V1Scope, novelId: string) =>
    queryOptions({
      queryKey: v1Keys.chapters(scope, novelId),
      queryFn: () => client.listChapters(novelId),
    }),
  manifest: (client: PntApiClient, scope: V1Scope, novelId: string) =>
    queryOptions({
      queryKey: v1Keys.manifest(scope, novelId),
      queryFn: () => client.getManifest(novelId),
    }),
  chapter: (client: PntApiClient, scope: V1Scope, novelId: string, chapterId: string) =>
    queryOptions({
      queryKey: v1Keys.chapter(scope, novelId, chapterId),
      queryFn: () => client.getChapter(novelId, chapterId),
    }),
  readerState: (client: PntApiClient, userId: string, novelId: string) =>
    queryOptions({
      queryKey: v1Keys.readerState(userId, novelId),
      queryFn: () => client.getReaderState(novelId),
    }),
  bookmarks: (
    client: PntApiClient,
    userId: string,
    novelId: string,
    cursor: ReaderBookmarkCursor | null = null,
  ) =>
    queryOptions({
      queryKey: v1Keys.bookmarks(userId, novelId, cursor),
      queryFn: () => client.listBookmarks(novelId, cursor),
    }),
};
