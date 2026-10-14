import { z } from "zod";

import type { NovelListItem } from "@/lib/content/novel/novel.functions";
import { publishState } from "@/lib/content/publish/publish";
import { collatorFor } from "@/lib/i18n/format";
import { defaultLocale } from "@/lib/i18n/locales";

export type LibrarySort = "newest" | "updated" | "title";
export type LibraryPublication = "all" | "draft" | "scheduled" | "live";

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
  })
  .transform(({ q, sort, view, language, publication }) => ({
    q: q ?? "",
    sort: sort ?? "newest",
    view: view ?? "grid",
    language: language ?? "all",
    publication: publication ?? "all",
  }));

export type LibrarySearch = z.infer<typeof librarySearchSchema>;
export type LibraryNovel = NovelListItem;

/**
 * A language pair as a filter label: "en->th" is an internal value, and a reader sees a pair.
 * The "all languages" label is a catalog message, so it is not built here.
 */
export function formatLibraryLanguage(value: string): string {
  return value.replace("->", " → ");
}

function timestamp(value: Date | string | null | undefined): number {
  const result = value ? new Date(value).getTime() : 0;
  return Number.isFinite(result) ? result : 0;
}

function compareNovels(
  a: LibraryNovel,
  b: LibraryNovel,
  sort: LibrarySearch["sort"],
  collator: Intl.Collator,
): number {
  if (sort === "title") {
    return collator.compare(a.title, b.title) || a.id.localeCompare(b.id);
  }

  const aDate = timestamp(sort === "updated" ? a.updatedAt : a.createdAt);
  const bDate = timestamp(sort === "updated" ? b.updatedAt : b.createdAt);
  return bDate - aDate || a.id.localeCompare(b.id);
}

export function selectLibraryNovels(
  novels: readonly LibraryNovel[],
  search: LibrarySearch,
  isAdmin: boolean,
  /**
   * The comparison a title sort uses. `new Intl.Collator("en")` orders Thai titles by code
   * point, so the page passes the collator for the language it is being read in; the
   * default only serves callers with no reader (a test, a script).
   */
  collator: Intl.Collator = collatorFor(defaultLocale),
): LibraryNovel[] {
  const query = search.q.trim().toLocaleLowerCase();
  const result = novels.filter((novel) => {
    if (
      isAdmin &&
      search.publication !== "all" &&
      search.publication !== publishState(novel.publishedAt)
    ) {
      return false;
    }

    const language = `${novel.sourceLang}->${novel.targetLang}`;
    if (search.language !== "all" && language !== search.language) {
      return false;
    }

    if (!query) return true;
    return [novel.title, novel.originalTitle, novel.author]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(query));
  });

  return result.toSorted((a, b) => compareNovels(a, b, search.sort, collator));
}
