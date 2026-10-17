// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { novelsQueryOptions } from "@/components/novels/library/library-query";
import type { LibraryNovel } from "@/components/novels/library/library-search";
import { JOB_STATS_QUERY_KEY } from "@/lib/job-dashboard/query";
import { readerStateQueryOptions } from "@/lib/reader/query";
import type { ViewerUser } from "@/lib/profile/types";

import { ReadingHome } from "./reading-home";

interface LinkLikeProps {
  children?: ReactNode;
  [key: string]: unknown;
}

// The home is reached through a `<Link>` and a cover; both are other modules' business,
// and the router is not mounted in a component test. The anchor keeps the props the
// router would have merged onto it — an `href` to carry the link role in jsdom, plus the
// `role="button"` Base UI adds when a Button renders one — while the router-only props
// are dropped, since they would land on the DOM node as invalid attributes.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    preload,
    viewTransition,
    activeProps,
    ...rest
  }: LinkLikeProps) => {
    void params;
    void preload;
    void viewTransition;
    void activeProps;
    return createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children);
  },
}));

vi.mock("@/components/novels/novel-cover", () => ({
  NovelCover: ({ alt }: { alt?: string }) => createElement("img", { alt: alt ?? "" }),
}));

const viewer = {
  id: "user-1",
  name: "E2E Admin",
  email: "e2e-admin@example.test",
} as unknown as ViewerUser;

function novel(id: string, title: string, overrides: Partial<LibraryNovel> = {}): LibraryNovel {
  return {
    id,
    title,
    originalTitle: null,
    author: "A Translator",
    authorId: null,
    tags: [],
    description: null,
    sourceLang: "zh",
    targetLang: "th",
    publishedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    hasCover: 1,
    chapterCount: 4,
    translatedCount: 2,
    coverUrl: null,
    coverSrcSet: null,
    ...overrides,
  };
}

interface RenderHomeInput {
  novels: LibraryNovel[];
  /** Keyed by novel id; only the novels whose reader stopped somewhere appear here. */
  readerStates?: Record<string, { lastChapterId: string; readChapterIds: string[] }>;
  stats?: {
    activeTranslationJobs?: number;
    activeImportJobs?: number;
    failedTranslationJobs?: number;
    failedImportJobs?: number;
  };
}

/**
 * Everything the home reads arrives through the query cache, so seeding it is what
 * decides the state under test — and a seeded cache means no server function runs.
 */
function renderHome({ novels, readerStates = {}, stats = {} }: RenderHomeInput): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(novelsQueryOptions("mine", "en").queryKey, {
    novels,
    total: novels.length,
    page: 1,
    pageSize: 24,
    hasMore: false,
  });
  for (const [novelId, state] of Object.entries(readerStates)) {
    queryClient.setQueryData(readerStateQueryOptions(novelId).queryKey, {
      ...state,
      scrollFraction: null,
      bookmarks: [],
      bookmarkNextCursor: null,
    });
  }
  queryClient.setQueryData(JOB_STATS_QUERY_KEY, {
    avgChunkLatencyMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    activeTranslationJobs: 0,
    failedTranslationJobs: 0,
    activeImportJobs: 0,
    failedImportJobs: 0,
    ...stats,
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ReadingHome user={viewer} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("ReadingHome", () => {
  it("names the landing heading and offers exactly one way to start a novel", () => {
    renderHome({ novels: [novel("novel-1", "Father and Son at Dawn")] });

    // The signed-in front door. The reader upgrade specs assert this heading, and the
    // header action is a single control rather than one per section.
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New novel" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Father and Son at Dawn/ })).toBeTruthy();
  });

  it("resumes the chapters a reader was in the middle of, with position", () => {
    renderHome({
      novels: [novel("novel-1", "Father and Son at Dawn")],
      readerStates: { "novel-1": { lastChapterId: "chapter-2", readChapterIds: ["chapter-1"] } },
    });

    expect(screen.getByRole("heading", { name: "Continue reading" })).toBeTruthy();
    expect(screen.getByText("1 of 4 chapters read")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Father and Son at Dawn.*Continue/s })).toBeTruthy();
  });

  it("hides the continue section when no chapter was opened yet", () => {
    renderHome({ novels: [novel("novel-1", "Father and Son at Dawn")] });

    expect(screen.queryByRole("heading", { name: "Continue reading" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your novels" })).toBeTruthy();
  });

  it("invites a new account without repeating the action", () => {
    renderHome({ novels: [] });

    expect(screen.getByRole("heading", { name: "No novels yet" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New novel" })).toHaveLength(1);
  });

  it("reports what is running and what needs attention", () => {
    renderHome({
      novels: [novel("novel-1", "Father and Son at Dawn")],
      stats: { activeTranslationJobs: 1, activeImportJobs: 1, failedTranslationJobs: 1 },
    });

    // Two running (one of each kind) and the failed one, which is the only anxious state.
    expect(screen.getByText("Running").nextElementSibling?.textContent).toBe("2");
    expect(screen.getByText("Needs attention").nextElementSibling?.textContent).toBe("1");
  });
});
