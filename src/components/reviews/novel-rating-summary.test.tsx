// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NovelRatingSummary as RatingSummary } from "@/lib/reviews/types";

import { NovelRatingSummary } from "./novel-rating-summary";

const getNovelRating = vi.fn<() => Promise<RatingSummary>>();

vi.mock("@/lib/reviews/functions", () => ({
  getNovelRating: () => getNovelRating(),
}));

const EMPTY: RatingSummary = {
  average: null,
  count: 0,
  distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: 0 })),
};

const RATED: RatingSummary = {
  average: 4.6,
  count: 12,
  distribution: [
    { rating: 5, count: 8 },
    { rating: 4, count: 3 },
    { rating: 3, count: 1 },
    { rating: 2, count: 0 },
    { rating: 1, count: 0 },
  ],
};

function renderSummary() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NovelRatingSummary novelId="novel-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  getNovelRating.mockReset();
});

describe("NovelRatingSummary", () => {
  it("shows nothing at all for a novel nobody has rated", async () => {
    getNovelRating.mockResolvedValue(EMPTY);
    const { container } = renderSummary();

    await waitFor(() => expect(getNovelRating).toHaveBeenCalled());

    expect(container.textContent).toBe("");
  });

  it("shows the score, the count, and the way to the reviews", async () => {
    getNovelRating.mockResolvedValue(RATED);
    renderSummary();

    expect(await screen.findByText("4.6")).toBeTruthy();
    expect(screen.getByText(/12 ratings/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /4.6/ }).getAttribute("href")).toBe("#reviews");
  });
});
