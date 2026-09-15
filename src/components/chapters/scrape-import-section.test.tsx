// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scrapeChapter: vi.fn(),
  importChapter: vi.fn(),
  useImportJob: vi.fn(),
  startImport: vi.fn(),
  cancelImport: vi.fn(),
  retryImport: vi.fn(),
  retryImportStatus: vi.fn(),
}));

vi.mock("@/lib/scrape/functions", () => ({
  scrapeChapter: mocks.scrapeChapter,
  importChapter: mocks.importChapter,
}));
vi.mock("./use-import-job", () => ({
  useImportJob: mocks.useImportJob,
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { ScrapeImportSection } from "./scrape-import-section";
import type { ImportJobController } from "./use-import-job";

const defaultController = (): ImportJobController => ({
  importJob: null,
  importActive: false,
  initialStatusLoading: false,
  startPending: false,
  startImport: mocks.startImport,
  cancelImport: mocks.cancelImport,
  attachJob: vi.fn(),
  retryImport: mocks.retryImport,
  importStatusError: null,
  canRetryImport: false,
  retryImportStatus: mocks.retryImportStatus,
});

function renderScrape(
  otherImportActive = false,
  importController = defaultController(),
  bulkStartDisabled = importController.initialStatusLoading,
) {
  const onChapterFetched = vi.fn();
  render(
    <ScrapeImportSection
      novelId="novel-1"
      invalidateChapters={vi.fn()}
      importController={importController}
      bulkStartDisabled={bulkStartDisabled}
      onChapterFetched={onChapterFetched}
      otherImportActive={otherImportActive}
    />,
  );
  return { onChapterFetched, importController };
}

describe("ScrapeImportSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards the source URL on preview and retains the next URL", async () => {
    mocks.scrapeChapter.mockResolvedValueOnce({
      number: 3,
      title: "A chapter",
      content: "Source text",
      nextUrl: "https://example.test/chapter-4",
    });
    const { onChapterFetched } = renderScrape();
    const urlInput = screen.getByLabelText("Chapter source URL") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://example.test/chapter-3" } });

    fireEvent.click(screen.getByRole("button", { name: "Preview chapter" }));

    await vi.waitFor(() => expect(onChapterFetched).toHaveBeenCalledTimes(1));
    expect(onChapterFetched).toHaveBeenCalledWith({
      number: "3",
      title: "A chapter",
      content: "Source text",
      sourceUrl: "https://example.test/chapter-3",
    });
    expect(urlInput.value).toBe("https://example.test/chapter-4");
  });

  it("provides URL and numeric input metadata", () => {
    renderScrape();
    const urlInput = screen.getByLabelText("Chapter source URL") as HTMLInputElement;
    const fromInput = screen.getByLabelText("First chapter") as HTMLInputElement;
    const toInput = screen.getByLabelText("Last chapter") as HTMLInputElement;

    expect(urlInput.type).toBe("url");
    expect(urlInput.name).toBe("sourceUrl");
    expect(urlInput.inputMode).toBe("url");
    expect(urlInput.autocomplete).toBe("off");
    expect(urlInput.getAttribute("autocapitalize")).toBe("none");
    expect(urlInput.getAttribute("spellcheck")).toBe("false");
    expect(fromInput.name).toBe("rangeFrom");
    expect(fromInput.autocomplete).toBe("off");
    expect(toInput.name).toBe("rangeTo");
    expect(toInput.autocomplete).toBe("off");
  });

  it("shows invalid range feedback inline and clears it when the range changes", () => {
    renderScrape();
    fireEvent.change(screen.getByLabelText("Chapter source URL"), {
      target: { value: "https://example.test/chapter-1" },
    });
    const fromInput = screen.getByLabelText("First chapter");
    const toInput = screen.getByLabelText("Last chapter");
    fireEvent.change(fromInput, { target: { value: "5" } });
    fireEvent.change(toInput, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Start range import" }));

    const message =
      "Enter a valid range: first chapter must be at least 1, last chapter cannot be earlier, and the range can contain at most 500 chapters.";
    expect(screen.getByText(message)).toBeTruthy();
    expect(mocks.startImport).not.toHaveBeenCalled();

    fireEvent.change(toInput, { target: { value: "6" } });
    expect(screen.queryByText(message)).toBeNull();
  });

  it("blocks only range start while another bulk import is active", () => {
    const { onChapterFetched } = renderScrape(true);
    const urlInput = screen.getByLabelText("Chapter source URL");
    fireEvent.change(urlInput, { target: { value: "https://example.test/chapter-1" } });

    const rangeButton = screen.getByRole("button", { name: "Start range import" });
    expect(rangeButton.getAttribute("disabled")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Preview chapter" }).getAttribute("disabled"),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add without preview" }).getAttribute("disabled"),
    ).toBeNull();
    expect(
      screen.getByText("Finish or cancel the EPUB import before starting another bulk import."),
    ).toBeTruthy();
    expect(onChapterFetched).not.toHaveBeenCalled();
  });
  it("renders import counters and exposes cancel while a range is running", () => {
    const importController = {
      ...defaultController(),
      importJob: {
        id: "scrape-job-1",
        kind: "scrape" as const,
        status: "running" as const,
        sourceFileName: null,
        fromNumber: 1,
        toNumber: 5,
        nextNumber: 4,
        added: 2,
        skipped: 1,
        failed: 0,
        error: null,
      },
      importActive: true,
    };
    renderScrape(false, importController);

    expect(screen.getByText("3 of 5 chapters")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel import" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    expect(mocks.cancelImport).toHaveBeenCalledTimes(1);
  });

  it("offers a range retry for a resumable terminal import", () => {
    const importController = {
      ...defaultController(),
      importJob: {
        id: "scrape-job-1",
        kind: "scrape" as const,
        status: "error" as const,
        sourceFileName: null,
        fromNumber: 1,
        toNumber: 5,
        nextNumber: 4,
        added: 2,
        skipped: 1,
        failed: 1,
        error: "Chapter 4 failed",
      },
      canRetryImport: true,
    };
    renderScrape(false, importController);

    fireEvent.click(screen.getByRole("button", { name: "Retry range import" }));
    expect(mocks.retryImport).toHaveBeenCalledTimes(1);
  });
});
