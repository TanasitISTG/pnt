// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestI18nProvider } from "@/test/i18n";
import type { AccountAudience, AccountAudienceTotals } from "@/lib/analytics/types";

import { AccountAudiencePage } from "./account-audience-page";

const analyticsFunctions = vi.hoisted(() => ({ getAccountAudience: vi.fn() }));

vi.mock("@/lib/analytics/functions", () => analyticsFunctions);

// The anchor keeps the props the router would have merged onto it — the href to carry the
// link role, and the `role="button"` Base UI adds when a Button renders one. Only the
// router-only props are dropped, because they would land on the DOM node as invalid
// attributes.
function LinkLike({
  children,
  to,
  params,
  preload,
  activeProps,
  ...rest
}: {
  children?: ReactNode;
  to?: string;
  params?: Record<string, string>;
  preload?: unknown;
  activeProps?: unknown;
  [key: string]: unknown;
}) {
  void params;
  void preload;
  void activeProps;
  return createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children);
}
vi.mock("@tanstack/react-router", () => ({ Link: LinkLike }));

const PUBLISHED = new Date("2026-10-01T00:00:00.000Z");

function totals(overrides: Partial<AccountAudienceTotals> = {}): AccountAudienceTotals {
  return {
    novels: 2,
    publishedNovels: 1,
    readers: 2,
    reads: 3,
    followers: 1,
    waitingFollowers: 1,
    hasAnyReads: true,
    ...overrides,
  };
}

function audience(overrides: Partial<AccountAudience> = {}): AccountAudience {
  return {
    totals: totals(),
    novels: [
      {
        id: "novel-1",
        title: "First Novel",
        publishedAt: PUBLISHED,
        readers: 2,
        reads: 3,
        followers: 1,
        waitingFollowers: 1,
      },
      {
        id: "novel-2",
        title: "Second Novel",
        publishedAt: null,
        readers: 0,
        reads: 0,
        followers: 0,
        waitingFollowers: 0,
      },
    ],
    daily: Array.from({ length: 30 }, (_, index) => ({
      day: `2026-09-${String(index + 18).padStart(2, "0")}`,
      reads: index === 20 ? 3 : 0,
    })),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TestI18nProvider>
        <AccountAudiencePage />
      </TestI18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  analyticsFunctions.getAccountAudience.mockReset();
});

/**
 * The rollup's contract is that it is a rollup: the totals describe every owned novel at
 * once, and every novel keeps a row even when nobody has read it, because "followed but
 * unread" is the interesting case rather than an empty one.
 */
describe("AccountAudiencePage", () => {
  it("shows account totals and a row per novel, unread ones included", async () => {
    analyticsFunctions.getAccountAudience.mockResolvedValue(audience());

    renderPage();

    // The heading is part of the shell; the wait is for the rollup underneath it.
    expect(await screen.findByText("Finished in this range: 3")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Audience across your novels" })).toBeTruthy();
    expect(screen.getByText("By novel")).toBeTruthy();

    const firstRow = screen.getByRole("row", { name: /First Novel/ });
    expect(within(firstRow).getByRole("link", { name: "First Novel" })).toBeTruthy();
    expect(within(firstRow).getByText("Published", { exact: false })).toBeTruthy();

    // The unread novel is still listed, named as the draft it is, with every figure at zero.
    const secondRow = screen.getByRole("row", { name: /Second Novel/ });
    expect(within(secondRow).getByText("Draft")).toBeTruthy();
    // Readers, finishes, followers and waiting — the fixed thirty-day column is gone, because
    // the range above now says which window those read figures describe.
    expect(within(secondRow).getAllByText("0")).toHaveLength(4);

    expect(screen.getByText("Counts signed-in readers only; guests are not tracked.")).toBeTruthy();
  });

  it("re-reads the rollup for the selected range", async () => {
    analyticsFunctions.getAccountAudience.mockResolvedValue(audience());

    renderPage();

    await screen.findByText("Finished in this range: 3");
    expect(screen.getByRole("button", { name: "30 days" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.queryByRole("columnheader", { name: "Last 30 days" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "90 days" }));

    await waitFor(() =>
      expect(analyticsFunctions.getAccountAudience).toHaveBeenCalledWith({
        data: { range: "90d" },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "90 days" }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
  });

  it("offers the empty state, not an empty table, before the account has a novel", async () => {
    analyticsFunctions.getAccountAudience.mockResolvedValue(
      audience({
        totals: totals({
          novels: 0,
          publishedNovels: 0,
          readers: 0,
          reads: 0,
          followers: 0,
          waitingFollowers: 0,
          hasAnyReads: false,
        }),
        novels: [],
      }),
    );

    renderPage();

    expect(await screen.findByText("No novels yet")).toBeTruthy();
    expect(screen.queryByText("By novel")).toBeNull();
    expect(screen.getByRole("button", { name: "Create a novel" })).toBeTruthy();
  });
});
