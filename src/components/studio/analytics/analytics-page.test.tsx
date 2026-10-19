// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestI18nProvider } from "@/test/i18n";
import type { ChapterAudience, NovelAudience } from "@/lib/analytics/types";

import { AnalyticsPage } from "./analytics-page";

const analyticsFunctions = vi.hoisted(() => ({ getNovelAudience: vi.fn() }));

vi.mock("@/lib/analytics/functions", () => analyticsFunctions);

// The way up to the account rollup is a router link rendered as a button; this file is
// about the report it sits above, so the anchor only has to carry the role.
function LinkLike({
  children,
  to,
  params,
  preload,
  ...rest
}: {
  children?: ReactNode;
  to?: string;
  params?: Record<string, string>;
  preload?: unknown;
  [key: string]: unknown;
}) {
  void params;
  void preload;
  return createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children);
}
vi.mock("@tanstack/react-router", () => ({ Link: LinkLike }));

const PUBLISHED = new Date("2026-10-01T00:00:00.000Z");

function chapter(
  id: string,
  number: number,
  readers: number,
  lastReached: number,
): ChapterAudience {
  return {
    chapterId: id,
    number,
    title: `Chapter ${number}`,
    translatedTitle: null,
    publishedAt: PUBLISHED,
    readers,
    lastReached,
  };
}

function audience(overrides: Partial<NovelAudience> = {}): NovelAudience {
  return {
    totals: {
      readers: 4,
      reads: 5,
      followers: 2,
      waitingFollowers: 1,
      hasAnyReads: true,
      newestChapter: { id: "c3", number: 3, title: "Chapter 3", publishedAt: PUBLISHED },
    },
    chapters: [chapter("c1", 1, 3, 2), chapter("c2", 2, 1, 1), chapter("c3", 3, 1, 1)],
    daily: Array.from({ length: 30 }, (_, index) => ({
      day: `2026-09-${String(index + 18).padStart(2, "0")}`,
      reads: index === 21 ? 4 : 0,
    })),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TestI18nProvider>
        <AnalyticsPage novelId="novel-1" />
      </TestI18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  analyticsFunctions.getNovelAudience.mockReset();
});

/**
 * The report is only useful if the three questions it answers are legible without arithmetic:
 * how many readers there are, where they stopped, and how many followers are waiting for the
 * next release. The numbers also have to carry their own caveat, because a guest read is
 * invisible to this table and a reader would otherwise take the total for all traffic.
 */
describe("AnalyticsPage", () => {
  it("shows totals, the waiting count and the per-chapter drop-off", async () => {
    analyticsFunctions.getNovelAudience.mockResolvedValue(audience());

    renderPage();

    // The heading is part of the shell, so the wait is for the report underneath it.
    await waitFor(() => expect(screen.getByText("Finished in this range: 5")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Audience" })).toBeTruthy();
    // The word is both a tile label and the table's column header.
    expect(screen.getAllByText("Readers").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Waiting for the next chapter")).toBeTruthy();
    expect(screen.getByText("Newest chapter: 3 — Chapter 3")).toBeTruthy();

    expect(screen.getByText("Chapter 1")).toBeTruthy();
    expect(screen.getByText("Chapter 3")).toBeTruthy();
    // 3 of 4 readers reached chapter one; the share is what makes a thin chapter visible.
    expect(screen.getByText("· 75%")).toBeTruthy();
    expect(screen.getByText("Counts signed-in readers only; guests are not tracked.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All novels" })).toBeTruthy();
  });

  it("re-reads the report for the selected range instead of filtering the month client-side", async () => {
    analyticsFunctions.getNovelAudience.mockResolvedValue(audience());

    renderPage();

    await waitFor(() => expect(screen.getByText("Finished in this range: 5")).toBeTruthy());
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "7 days" }));

    // Distinct readers in a week cannot be derived from a month's totals, so the window goes
    // to the server rather than filtering the answer it already has.
    await waitFor(() =>
      expect(analyticsFunctions.getNovelAudience).toHaveBeenCalledWith({
        data: { novelId: "novel-1", range: "7d" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "7 days" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });

  it("keeps the report on a quiet window instead of calling the audience empty", async () => {
    analyticsFunctions.getNovelAudience.mockResolvedValue(
      audience({
        totals: {
          readers: 0,
          reads: 0,
          followers: 2,
          waitingFollowers: 1,
          hasAnyReads: true,
          newestChapter: { id: "c3", number: 3, title: "Chapter 3", publishedAt: PUBLISHED },
        },
        daily: Array.from({ length: 7 }, (_, index) => ({
          day: `2026-10-${String(index + 11).padStart(2, "0")}`,
          reads: 0,
        })),
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Finished in this range: 0")).toBeTruthy());
    // The novel has an audience; this particular window has no finishes in it.
    expect(screen.getByText("By chapter")).toBeTruthy();
    expect(screen.queryByText("No readers yet")).toBeNull();
    expect(screen.getByText("Waiting for the next chapter")).toBeTruthy();
  });

  it("offers the caveat instead of an empty table when nobody has finished a chapter", async () => {
    analyticsFunctions.getNovelAudience.mockResolvedValue(
      audience({
        totals: {
          readers: 0,
          reads: 0,
          followers: 0,
          waitingFollowers: 0,
          hasAnyReads: false,
          newestChapter: null,
        },
        chapters: [chapter("c1", 1, 0, 0)],
        daily: Array.from({ length: 30 }, (_, index) => ({
          day: `2026-09-${String(index + 18).padStart(2, "0")}`,
          reads: 0,
        })),
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("No readers yet")).toBeTruthy());
    expect(screen.queryByText("By chapter")).toBeNull();
    expect(screen.getByText("Counts signed-in readers only; guests are not tracked.")).toBeTruthy();
  });
});
