import { describe, expect, it } from "vitest";

import {
  CATALOG_LANGUAGES,
  LIBRARY_PUBLICATION_KEYS,
  LIBRARY_SORT_KEYS,
  authorCatalogFilters,
  catalogLanguage,
  formatLibraryLanguage,
  librarySearchSchema,
  toCatalogFilters,
} from "./library-search";

/**
 * What is left in this module is the vocabulary and the mapping into a request. The
 * filtering itself is the database's now, so its behaviour lives in the catalog integration
 * suite (`src/lib/content/catalog.integration.test.ts`); asserting it here would be testing
 * a copy that no longer exists.
 */

const allSearch = librarySearchSchema.parse({});

describe("library-search", () => {
  it("recovers malformed URL fields to safe defaults", () => {
    expect(
      librarySearchSchema.parse({
        q: 42,
        sort: "random",
        view: "table",
        language: 9,
        publication: "private",
        tag: 7,
      }),
    ).toEqual(allSearch);
  });

  it("maps every filter value to a catalog key, never to the raw value", () => {
    expect(LIBRARY_PUBLICATION_KEYS).toEqual({
      all: "publicationAll",
      draft: "publicationDraft",
      scheduled: "publicationScheduled",
      live: "publicationLive",
    });
    expect(LIBRARY_SORT_KEYS).toEqual({
      newest: "sortNewest",
      updated: "sortUpdated",
      title: "sortTitle",
    });
    // The property that matters: no filter value is ever the word a reader reads.
    expect(Object.values(LIBRARY_PUBLICATION_KEYS)).not.toContain("all");
    expect(Object.values(LIBRARY_SORT_KEYS)).not.toContain("newest");
  });

  it("names every supported pair the way the filter shows it", () => {
    expect(CATALOG_LANGUAGES).toEqual(["en->th", "zh->en", "zh->th"]);
    expect(formatLibraryLanguage("zh->en")).toBe("zh → en");
  });

  it("drops a language filter the product does not support", () => {
    expect(catalogLanguage("zh->th")).toBe("zh->th");
    expect(catalogLanguage("all")).toBeUndefined();
    expect(catalogLanguage("th->en")).toBeUndefined();
  });

  it("turns a search into request filters, omitting what is not filtered", () => {
    const filters = toCatalogFilters(
      { ...allSearch, q: "  river  ", sort: "title", tag: " xianxia ", locale: "th" } as never,
      "th",
    );

    expect(filters).toMatchObject({ q: "river", sort: "title", tag: "xianxia", locale: "th" });
    // "all" is the interface's way of saying "no filter", not a value the server receives.
    expect(catalogLanguage(filters.language)).toBeUndefined();
  });

  it("gives an author's page the one filter it has, from one shared definition", () => {
    expect(authorCatalogFilters("en", "author-1")).toEqual({
      q: "",
      sort: "newest",
      language: "all",
      publication: "all",
      tag: "",
      locale: "en",
      authorId: "author-1",
    });
  });
});
