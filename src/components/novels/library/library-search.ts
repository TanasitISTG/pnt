import { z } from "zod";

import {
  catalogLanguageSchema,
  type CatalogLanguage,
  type CatalogSort,
  type CatalogPublication,
} from "@/lib/content/novel/catalog.schemas";
import type { CatalogNovel } from "@/lib/content/novel/catalog.types";
import { defaultLocale, type Locale } from "@/lib/i18n/locales";

export type LibrarySort = CatalogSort;
export type LibraryPublication = CatalogPublication;

/**
 * Every language pair the product supports, in the order the filter lists them.
 *
 * A fixed list, not one derived from whatever happens to be loaded: the filter is a
 * property of the product, and with a page of results in hand there is no "everything"
 * to derive it from.
 */
export const CATALOG_LANGUAGES: readonly CatalogLanguage[] = ["en->th", "zh->en", "zh->th"];

/**
 * The `catalog` keys behind each filter value, so a value is only ever a value: nothing in
 * the interface shows the word "newest", it shows the sentence `sortNewest` translates to.
 * Keeping the mapping in this pure module is what lets the mapping be tested without a
 * translator at hand.
 */
export const LIBRARY_SORT_KEYS = {
  newest: "sortNewest",
  updated: "sortUpdated",
  title: "sortTitle",
} as const satisfies Record<LibrarySort, string>;

export const LIBRARY_PUBLICATION_KEYS = {
  all: "publicationAll",
  draft: "publicationDraft",
  scheduled: "publicationScheduled",
  live: "publicationLive",
} as const satisfies Record<LibraryPublication, string>;

export const librarySearchSchema = z
  .object({
    q: z.string().optional().catch(undefined),
    sort: z.enum(["newest", "updated", "title"]).optional().catch(undefined),
    view: z.enum(["grid", "list"]).optional().catch(undefined),
    language: z.string().optional().catch(undefined),
    publication: z.enum(["all", "draft", "scheduled", "live"]).optional().catch(undefined),
    tag: z.string().optional().catch(undefined),
  })
  .transform(({ q, sort, view, language, publication, tag }) => ({
    q: q ?? "",
    sort: sort ?? "newest",
    view: view ?? "grid",
    language: language ?? "all",
    publication: publication ?? "all",
    tag: tag ?? "",
  }));

export type LibrarySearch = z.infer<typeof librarySearchSchema>;

/** A directory row. The same row serves the catalog, the shelf, and an author's page. */
export type LibraryNovel = CatalogNovel;

/**
 * A language pair as a filter label: "en->th" is an internal value, and a reader sees a pair.
 * The "all languages" label is a catalog message, so it is not built here.
 */
export function formatLibraryLanguage(value: string): string {
  return value.replace("->", " → ");
}

/** A URL language value that names a pair the product supports, or nothing. */
export function catalogLanguage(value: string): CatalogLanguage | undefined {
  const parsed = catalogLanguageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Everything one catalog request needs that is not in the URL. */
export interface CatalogFilters {
  q: string;
  sort: LibrarySort;
  language: string;
  publication: LibraryPublication;
  tag: string;
  locale: Locale;
  /** Set on an author's page, where the directory is one author's shelf. */
  authorId?: string;
}

/**
 * The search a route holds, as the filters a request takes.
 *
 * This is the seam that used to be `selectLibraryNovels`: the same inputs, resolved into
 * what the database is asked for instead of into an array this browser filters. A value the
 * product cannot express ("all" language, no tag) is absent rather than sent as a sentinel.
 */
/**
 * The filters an author's page reads with.
 *
 * Shared by the route's prefetch and the component's query so the two cannot drift: a
 * loader that prefetched a different set would fill a cache key the page never reads.
 */
export function authorCatalogFilters(locale: Locale, authorId: string): CatalogFilters {
  return { q: "", sort: "newest", language: "all", publication: "all", tag: "", locale, authorId };
}

export function toCatalogFilters(
  search: LibrarySearch,
  locale: Locale = defaultLocale,
  authorId?: string,
): CatalogFilters {
  return {
    q: search.q.trim(),
    sort: search.sort,
    language: search.language,
    publication: search.publication,
    tag: search.tag.trim(),
    locale,
    authorId,
  };
}
