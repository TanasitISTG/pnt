// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestI18nProvider } from "@/test/i18n";
import type { CatalogNovel, CatalogPage } from "@/lib/content/novel/catalog.types";

import { LibraryPage } from "./library-page";
import { librarySearchSchema, type LibrarySearch } from "./library-search";

const serverFunctions = vi.hoisted(() => ({
  listNovels: vi.fn(),
}));

const tagFunctions = vi.hoisted(() => ({
  getCatalogTags: vi.fn(async () => []),
}));

vi.mock("@/lib/content/novel/novel.functions", () => serverFunctions);
vi.mock("@/lib/content/novel/tag.functions", () => tagFunctions);

function LinkLike({ children, ...rest }: { children?: ReactNode; [key: string]: unknown }) {
  void rest;
  return createElement("a", { href: "#" }, children);
}
vi.mock("@tanstack/react-router", () => ({ Link: LinkLike }));

// The card is another module's business (and it needs the router and a cover); the page's
// contract is which novels it renders and when it asks for the next page.
vi.mock("@/components/novels/novel-card", () => ({
  NovelCard: ({ novel: item }: { novel: CatalogNovel }) =>
    createElement("article", null, item.title),
}));

// The toolbar has its own suite; here it would only add Base UI's select machinery.
vi.mock("@/components/novels/library/library-toolbar", () => ({
  LibraryToolbar: () => createElement("div", { "data-testid": "toolbar" }),
}));

function catalogNovel(id: string, title: string): CatalogNovel {
  return {
    id,
    title,
    originalTitle: null,
    author: "A Translator",
    authorId: null,
    tags: [],
    description: null,
    sourceLang: "en",
    targetLang: "th",
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    hasCover: 0,
    chapterCount: 0,
    translatedCount: 0,
    coverUrl: null,
    coverSrcSet: null,
  };
}

function page(overrides: Partial<CatalogPage> = {}): CatalogPage {
  return {
    novels: [catalogNovel("n1", "First of the Catalog")],
    total: 2,
    page: 1,
    pageSize: 24,
    hasMore: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  serverFunctions.listNovels.mockReset();
});

function renderPage({
  search = librarySearchSchema.parse({}) as LibrarySearch,
  onSearchChange = vi.fn(),
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TestI18nProvider>
        <LibraryPage
          scope="public"
          signedIn={false}
          search={search}
          onSearchChange={onSearchChange}
        />
      </TestI18nProvider>
    </QueryClientProvider>,
  );
  return { onSearchChange };
}

/**
 * The catalog is walked a page at a time. Before this change the whole table arrived at
 * once and the browser filtered it, so "Load more" is the visible half of moving that work
 * to the server: page one, then exactly one more request for page two.
 */
describe("LibraryPage paging", () => {
  it("appends the next page and stops offering one when the catalog ends", async () => {
    serverFunctions.listNovels.mockResolvedValueOnce(page()).mockResolvedValueOnce(
      page({
        novels: [catalogNovel("n2", "Second of the Catalog")],
        total: 2,
        page: 2,
        hasMore: false,
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("First of the Catalog")).toBeTruthy());
    expect(serverFunctions.listNovels).toHaveBeenCalledTimes(1);

    const loadMore = screen.getByRole("button", { name: "Load more novels" });
    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.getByText("Second of the Catalog")).toBeTruthy());
    // The first page is still there: the list accumulates rather than replacing.
    expect(screen.getByText("First of the Catalog")).toBeTruthy();
    expect(serverFunctions.listNovels).toHaveBeenCalledTimes(2);
    expect(serverFunctions.listNovels.mock.calls[1]?.[0]).toMatchObject({
      data: { scope: "public", page: 2 },
    });
    expect(screen.queryByRole("button", { name: "Load more novels" })).toBeNull();
  });

  it("shows the no-matches state, not the empty catalog, when a filter excludes everything", async () => {
    serverFunctions.listNovels.mockResolvedValue(page({ novels: [], total: 0, hasMore: false }));

    const { onSearchChange } = renderPage({
      search: librarySearchSchema.parse({ q: "nothing matches this" }) as LibrarySearch,
    });

    await waitFor(() => expect(screen.getByText("No novels match these filters")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onSearchChange).toHaveBeenCalledWith({
      q: "",
      language: "all",
      publication: "all",
      tag: "",
    });
  });
});
