// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogAuthor, CatalogNovel, CatalogPage } from "@/lib/content/novel/catalog.types";
import { TestI18nProvider } from "@/test/i18n";

import { AuthorPage } from "./author-page";

const novelFunctions = vi.hoisted(() => ({ listNovels: vi.fn() }));
const authorFunctions = vi.hoisted(() => ({
  searchAuthors: vi.fn(async () => []),
  mergeAuthors: vi.fn(),
}));

vi.mock("@/lib/content/novel/novel.functions", () => novelFunctions);
vi.mock("@/lib/content/novel/author.functions", () => authorFunctions);
vi.mock("@/lib/i18n/use-localized-params", () => ({ useLocalizedParams: () => ({}) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/components/novels/novel-card", () => ({
  NovelCard: ({ novel }: { novel: CatalogNovel }) => createElement("article", null, novel.title),
}));

const author: CatalogAuthor = { id: "author-1", name: "Liu Cixin", novelCount: 3 };

function catalogNovel(id: string, title: string): CatalogNovel {
  return {
    id,
    title,
    originalTitle: null,
    author: "Liu Cixin",
    authorId: author.id,
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
    tags: [],
  };
}

function page(overrides: Partial<CatalogPage> = {}): CatalogPage {
  return {
    novels: [catalogNovel("n1", "The Three-Body Problem")],
    total: 3,
    page: 1,
    pageSize: 24,
    hasMore: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  novelFunctions.listNovels.mockReset();
  authorFunctions.searchAuthors.mockClear();
});

function renderPage({ isOperator = false }: { isOperator?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TestI18nProvider>
        <AuthorPage author={author} isOperator={isOperator} />
      </TestI18nProvider>
    </QueryClientProvider>,
  );
}

/**
 * The author page is the catalog with one filter applied, not a second directory, so its
 * contract is that filter: the same paged read, narrowed by `authorId`, showing live rows
 * only. An author page that queried novels itself would be a second place the publication
 * rule could drift, and one that filtered client-side would pull a whole catalog to show one
 * person's shelf.
 */
describe("AuthorPage", () => {
  it("reads the catalog narrowed by the author and pages through it", async () => {
    novelFunctions.listNovels.mockResolvedValueOnce(page()).mockResolvedValueOnce(
      page({
        novels: [catalogNovel("n2", "Ball Lightning")],
        total: 3,
        page: 2,
        hasMore: false,
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("The Three-Body Problem")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Liu Cixin" })).toBeTruthy();
    expect(screen.getByText("3 novels")).toBeTruthy();
    expect(novelFunctions.listNovels.mock.calls[0]?.[0]).toMatchObject({
      data: { scope: "public", page: 1, authorId: author.id },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load more novels" }));

    await waitFor(() => expect(screen.getByText("Ball Lightning")).toBeTruthy());
    // The shelf accumulates; the first page is not replaced by the second.
    expect(screen.getByText("The Three-Body Problem")).toBeTruthy();
    expect(novelFunctions.listNovels.mock.calls[1]?.[0]).toMatchObject({
      data: { scope: "public", page: 2, authorId: author.id },
    });
    expect(screen.queryByRole("button", { name: "Load more novels" })).toBeNull();
  });

  it("offers the merge correction only to an operator", async () => {
    novelFunctions.listNovels.mockResolvedValue(page({ novels: [], total: 0, hasMore: false }));

    renderPage();
    await waitFor(() => expect(screen.getByText("No novels yet")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Merge into another author" })).toBeNull();

    cleanup();
    novelFunctions.listNovels.mockResolvedValue(page({ novels: [], total: 0, hasMore: false }));
    renderPage({ isOperator: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Merge into another author" })).toBeTruthy(),
    );
  });
});
