import { describe, expect, it } from "vitest";

import {
  CATALOG_MAX_PAGE,
  CATALOG_PAGE_SIZE,
  CATALOG_SEARCH_MAX_LENGTH,
  MAX_NOVEL_TAGS,
  catalogInputSchema,
  setNovelTagsSchema,
} from "./catalog.schemas";

describe("catalogInputSchema", () => {
  it("defaults to the public first page without filters", () => {
    expect(catalogInputSchema.parse({})).toEqual({
      scope: "public",
      page: 1,
      sort: "newest",
      publication: "all",
      locale: "th",
    });
    expect(CATALOG_PAGE_SIZE).toBe(24);
  });

  it("refuses a page outside the bound instead of clamping it", () => {
    expect(catalogInputSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(catalogInputSchema.safeParse({ page: CATALOG_MAX_PAGE + 1 }).success).toBe(false);
    expect(catalogInputSchema.safeParse({ page: 2.5 }).success).toBe(false);
    expect(catalogInputSchema.safeParse({ page: CATALOG_MAX_PAGE }).success).toBe(true);
  });

  it("refuses a search term long enough to be an excuse for a scan", () => {
    expect(catalogInputSchema.safeParse({ q: "x".repeat(CATALOG_SEARCH_MAX_LENGTH) }).success).toBe(
      true,
    );
    expect(
      catalogInputSchema.safeParse({ q: "x".repeat(CATALOG_SEARCH_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("accepts only the pairs the product supports", () => {
    expect(catalogInputSchema.safeParse({ language: "zh->th" }).success).toBe(true);
    expect(catalogInputSchema.safeParse({ language: "th->en" }).success).toBe(false);
    expect(catalogInputSchema.safeParse({ language: "all" }).success).toBe(false);
  });

  it("folds a tag slug so one tag is one filter value", () => {
    expect(catalogInputSchema.parse({ tag: "  Xianxia  " }).tag).toBe("xianxia");
    expect(catalogInputSchema.parse({ tag: "Slow Burn" }).tag).toBe("slow-burn");
  });
});

describe("setNovelTagsSchema", () => {
  it("dedupes and trims what the editor sends", () => {
    expect(
      setNovelTagsSchema.parse({ novelId: "n1", tags: [" Cultivation ", "Cultivation"] }),
    ).toEqual({ novelId: "n1", tags: ["Cultivation"] });
  });

  it("caps a novel at the vocabulary's per-novel limit", () => {
    const tooMany = Array.from({ length: MAX_NOVEL_TAGS + 1 }, (_, index) => `tag-${index}`);
    expect(setNovelTagsSchema.safeParse({ novelId: "n1", tags: tooMany }).success).toBe(false);
    expect(
      setNovelTagsSchema.safeParse({ novelId: "n1", tags: tooMany.slice(0, MAX_NOVEL_TAGS) })
        .success,
    ).toBe(true);
  });
});
