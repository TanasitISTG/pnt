import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";

import { catalogLanguage, type CatalogFilters } from "@/components/novels/library/library-search";
import type { CatalogInputPayload } from "@/lib/content/novel/catalog.schemas";
import { listNovels } from "@/lib/content/novel/novel.functions";
import { getCatalogTags } from "@/lib/content/novel/tag.functions";

/**
 * `mine` is the signed-in workspace (drafts, scheduled, and live, with every chapter
 * counted); `public` is the shared catalog (live novels only, chapters counted as a
 * guest would see them). The scope is an explicit input to the server function, and the
 * two views get distinct cache keys: sharing one key would let the owner's drafts be
 * served to the public catalog.
 */
export type LibraryScope = "mine" | "public";

/**
 * One key prefix for every catalog read, so an existing `invalidateQueries(["novels"])`
 * after a create, publish or delete reaches the paged list and the home screen's first page
 * alike. The third segment separates those two shapes, and the filters follow it.
 */
const catalogRoot = (scope: LibraryScope) => ["novels", scope] as const;

function payload(scope: LibraryScope, filters: CatalogFilters, page: number): CatalogInputPayload {
  const language = catalogLanguage(filters.language);
  return {
    scope,
    page,
    sort: filters.sort,
    publication: filters.publication,
    locale: filters.locale,
    ...(filters.q ? { q: filters.q } : {}),
    ...(language ? { language } : {}),
    ...(filters.tag ? { tag: filters.tag } : {}),
    ...(filters.authorId ? { authorId: filters.authorId } : {}),
  };
}

/**
 * The directory as the reader walks it.
 *
 * A page is the unit: the server answers twenty-four rows and the filtered total, and
 * "Load more" asks for the next page. The alternative — accumulate the table in the browser
 * once and filter it there — is what made the payload grow with the catalog.
 */
export const catalogQueryOptions = (scope: LibraryScope, filters: CatalogFilters) =>
  infiniteQueryOptions({
    queryKey: [...catalogRoot(scope), "page", filters] as const,
    queryFn: ({ pageParam }) => listNovels({ data: payload(scope, filters, pageParam) }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    staleTime: 15_000,
  });

/** The first page on its own, for a surface that is not a directory (the reading home). */
export const novelsQueryOptions = (scope: LibraryScope, locale: CatalogFilters["locale"]) =>
  queryOptions({
    queryKey: [...catalogRoot(scope), "first", locale] as const,
    queryFn: () => listNovels({ data: { scope, page: 1, locale } }),
    staleTime: 15_000,
  });

/** The vocabulary behind the filter row. Changes when a novel's tags do, and rarely. */
export const catalogTagsQueryOptions = () =>
  queryOptions({
    queryKey: ["catalogTags"] as const,
    queryFn: () => getCatalogTags(),
    staleTime: 60_000,
  });

/**
 * Fills the infinite cache entry with its first page during a route load.
 *
 * `fetchInfiniteQuery` is used rather than `ensureQueryData` because the entry's shape is
 * `{ pages, pageParams }`; writing a bare page into it would make the reader's first
 * "Load more" append to a list that is not there. Already-cached entries are left alone so
 * a client navigation does not refetch a page the reader just saw.
 */
export async function prefetchCatalogFirstPage(
  queryClient: QueryClient,
  scope: LibraryScope,
  filters: CatalogFilters,
): Promise<void> {
  const options = catalogQueryOptions(scope, filters);
  if (queryClient.getQueryData(options.queryKey)) return;
  await queryClient.fetchInfiniteQuery({ ...options, pages: 1 });
}
