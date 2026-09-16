// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVAL_SELECTOR_ERROR,
  type EvalReviewSearch,
} from "@/lib/translation/evaluation/eval.schemas";

const serverFunctions = vi.hoisted(() => ({
  startTranslationEval: vi.fn(),
  listTranslationEvalReports: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

const dialogState = vi.hoisted(() => ({ selector: "5-8" }));

vi.mock("@/lib/translation/evaluation/eval.functions", () => serverFunctions);
vi.mock("sonner", () => ({ toast: toastMocks }));
vi.mock("@/components/translation/translation-eval-report-dialog", () => ({
  TranslationEvalReportDialog: ({ onRunAgain }: { onRunAgain: (selector: string) => void }) => (
    <button type="button" onClick={() => onRunAgain(dialogState.selector)}>
      Run again
    </button>
  ),
}));

import { TranslationQualityPanel } from "@/components/translation/translation-quality-panel";

const REVIEW_SEARCH: EvalReviewSearch = {
  reviewReport: undefined,
  reviewFilter: "attention",
  reviewPage: 1,
  reviewPageSize: 25,
};

const CLOSED_REVIEW = {
  reviewReport: undefined,
  reviewFilter: "attention",
  reviewPage: 1,
  reviewPageSize: 25,
};

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onReviewSearchChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TranslationQualityPanel
        novelId="novel-1"
        reviewSearch={REVIEW_SEARCH}
        onReviewSearchChange={onReviewSearchChange}
      />
    </QueryClientProvider>,
  );
  return { onReviewSearchChange };
}

async function selectorInput() {
  return (await screen.findByLabelText("Chapters to check")) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  dialogState.selector = "5-8";
  serverFunctions.listTranslationEvalReports.mockResolvedValue([]);
  serverFunctions.startTranslationEval.mockResolvedValue({ reportId: "report-1" });
});

afterEach(cleanup);

describe("TranslationQualityPanel", () => {
  it("reports an invalid selection inline, focuses it, and queues nothing", async () => {
    const { onReviewSearchChange } = renderPanel();
    const selector = await selectorInput();

    fireEvent.change(selector, { target: { value: "1,,2" } });
    fireEvent.click(screen.getByRole("button", { name: "Run check" }));

    expect(await screen.findByText(EVAL_SELECTOR_ERROR)).toBeTruthy();
    expect(selector.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(selector);
    expect(serverFunctions.startTranslationEval).not.toHaveBeenCalled();
    expect(onReviewSearchChange).not.toHaveBeenCalled();
  });

  it("queues the transformed selector and opens the queued report", async () => {
    const { onReviewSearchChange } = renderPanel();
    const selector = await selectorInput();

    fireEvent.change(selector, { target: { value: "  all  " } });
    fireEvent.click(screen.getByRole("button", { name: "Run check" }));

    await waitFor(() =>
      expect(serverFunctions.startTranslationEval).toHaveBeenCalledWith({
        data: { novelId: "novel-1", chapterSelector: "all" },
      }),
    );
    expect(onReviewSearchChange).toHaveBeenCalledWith({
      reviewReport: "report-1",
      reviewFilter: "attention",
      reviewPage: 1,
      reviewPageSize: 25,
    });
    expect(toastMocks.success).toHaveBeenCalledWith("Quality check queued");
  });

  it("adopts the report's selector when the quality check is run again", async () => {
    renderPanel();
    const selector = await selectorInput();
    expect(selector.value).toBe("first3");

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));

    await waitFor(() =>
      expect(serverFunctions.startTranslationEval).toHaveBeenCalledWith({
        data: { novelId: "novel-1", chapterSelector: "5-8" },
      }),
    );
    expect(selector.value).toBe("5-8");
  });

  it("closes the review when the stored selection cannot be re-run", async () => {
    dialogState.selector = "1,,2";
    const { onReviewSearchChange } = renderPanel();
    await selectorInput();

    fireEvent.click(screen.getByRole("button", { name: "Run again" }));

    await waitFor(() => expect(onReviewSearchChange).toHaveBeenCalledWith(CLOSED_REVIEW));
    expect(serverFunctions.startTranslationEval).not.toHaveBeenCalled();
  });
});
