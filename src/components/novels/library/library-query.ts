import { queryOptions } from "@tanstack/react-query";

import { listNovels } from "@/lib/content/novel/novel.functions";

/**
 * `mine` is the signed-in workspace (drafts, scheduled, and live, with every chapter
 * counted); `public` is the shared catalog (live novels only, chapters counted as a
 * guest would see them). The scope is an explicit input to the server function, and
 * the two views get distinct cache keys: sharing one key would let the owner's drafts
 * be served to the public catalog.
 */
export type LibraryScope = "mine" | "public";

export const novelsQueryOptions = (scope: LibraryScope) =>
  queryOptions({
    queryKey: ["novels", scope] as const,
    queryFn: () => listNovels({ data: { scope } }),
  });
