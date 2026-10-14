import { describe, expect, it } from "vitest";

import {
  LIBRARY_PUBLICATION_KEYS,
  LIBRARY_SORT_KEYS,
  librarySearchSchema,
  selectLibraryNovels,
  type LibraryNovel,
} from "./library-search";

const novels: LibraryNovel[] = [
  {
    id: "draft-2",
    title: "Chapter 10",
    originalTitle: "Ten",
    author: "Aya",
    description: null,
    sourceLang: "zh",
    targetLang: "en",
    publishedAt: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-03"),
    hasCover: 0,
    coverUrl: null,
    coverSrcSet: null,
    chapterCount: 2,
    translatedCount: 1,
  },
  {
    id: "live-1",
    title: "Chapter 2",
    originalTitle: "Two",
    author: "Bo",
    description: null,
    sourceLang: "zh",
    targetLang: "en",
    publishedAt: new Date("2024-01-01"),
    createdAt: new Date("2025-02-01"),
    updatedAt: new Date("2025-02-02"),
    hasCover: 1,
    coverUrl: null,
    coverSrcSet: null,
    chapterCount: 3,
    translatedCount: 3,
  },
  {
    id: "scheduled-1",
    title: "River",
    originalTitle: "河",
    author: "Aya",
    description: null,
    sourceLang: "en",
    targetLang: "th",
    publishedAt: new Date("2099-01-01"),
    createdAt: new Date("2025-03-01"),
    updatedAt: new Date("2025-03-02"),
    hasCover: 0,
    coverUrl: null,
    coverSrcSet: null,
    chapterCount: 0,
    translatedCount: 0,
  },
];

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

  it("filters by searchable metadata and sorts titles naturally without mutating input", () => {
    const source = [...novels];
    const result = selectLibraryNovels(source, { ...allSearch, q: "chapter", sort: "title" }, true);

    expect(result.map((novel) => novel.title)).toEqual(["Chapter 2", "Chapter 10"]);
    expect(source.map((novel) => novel.id)).toEqual(["draft-2", "live-1", "scheduled-1"]);
  });

  it("applies publication and language filters only for admins", () => {
    expect(
      selectLibraryNovels(novels, { ...allSearch, publication: "draft" }, true).map(
        (novel) => novel.id,
      ),
    ).toEqual(["draft-2"]);
    expect(
      selectLibraryNovels(novels, { ...allSearch, publication: "draft" }, false).map(
        (novel) => novel.id,
      ),
    ).toEqual(["scheduled-1", "live-1", "draft-2"]);
    expect(
      selectLibraryNovels(novels, { ...allSearch, language: "en->th" }, true).map(
        (novel) => novel.id,
      ),
    ).toEqual(["scheduled-1"]);
  });
});
