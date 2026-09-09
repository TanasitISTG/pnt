import { z } from "zod";

import type { NovelListItem } from "@/lib/content/novel.functions";
import { publishState } from "@/lib/content/publish";

export type LibrarySort = "newest" | "updated" | "title";
export type LibraryPublication = "all" | "draft" | "scheduled" | "live";

export const LIBRARY_SORT_LABELS: Record<LibrarySort, string> = {
  newest: "Newest first",
  updated: "Recently updated",
  title: "Title A–Z",
};

export const LIBRARY_PUBLICATION_LABELS: Record<LibraryPublication, string> = {
  all: "All publication states",
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
};

export const LIBRARY_LANGUAGE_ALL_LABEL = "All languages";

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

export function formatLibraryLanguage(value: string): string {
  return value === "all" ? LIBRARY_LANGUAGE_ALL_LABEL : value.replace("->", " → ");
}

const titleCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function timestamp(value: Date | string | null | undefined): number {
  const result = value ? new Date(value).getTime() : 0;
  return Number.isFinite(result) ? result : 0;
}

function compareNovels(a: LibraryNovel, b: LibraryNovel, sort: LibrarySearch["sort"]): number {
  if (sort === "title") {
    return titleCollator.compare(a.title, b.title) || a.id.localeCompare(b.id);
  }

  const aDate = timestamp(sort === "updated" ? a.updatedAt : a.createdAt);
  const bDate = timestamp(sort === "updated" ? b.updatedAt : b.createdAt);
  return bDate - aDate || a.id.localeCompare(b.id);
}

export function selectLibraryNovels(
  novels: readonly LibraryNovel[],
  search: LibrarySearch,
  isAdmin: boolean,
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

  return result.toSorted((a, b) => compareNovels(a, b, search.sort));
}
