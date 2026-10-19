// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestI18nProvider } from "@/test/i18n";
import type { ChapterRow } from "@/components/chapters/types";

import { ChapterHistoryDialog } from "./chapter-history-dialog";

const historyFunctions = vi.hoisted(() => ({
  listChapterTranslationVersions: vi.fn(),
  getChapterTranslationVersion: vi.fn(),
  restoreChapterTranslationVersion: vi.fn(),
}));
const chapterFunctions = vi.hoisted(() => ({ getChapter: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/content/chapter/chapter-history.functions", () => historyFunctions);
vi.mock("@/lib/content/chapter/chapter.functions", () => chapterFunctions);
vi.mock("sonner", () => ({ toast }));

const chapter: ChapterRow = {
  id: "chapter-1",
  number: "1",
  title: "Chapter One",
  translatedTitle: "บทที่หนึ่ง",
  hasTranslation: true,
  hasHistory: true,
  status: "translated",
  rawCharCount: 20,
  publishedAt: null,
  editedAt: null,
};

const NEWEST = {
  id: "version-2",
  generation: 2,
  sourceRevision: 1,
  origin: "manual" as const,
  translatedTitle: "บทที่หนึ่ง",
  charCount: 24,
  createdAt: new Date("2026-10-02T09:00:00.000Z"),
};

const PREVIOUS = {
  id: "version-1",
  generation: 2,
  sourceRevision: 1,
  origin: "translation" as const,
  translatedTitle: "บทที่หนึ่ง",
  charCount: 24,
  createdAt: new Date("2026-10-01T09:00:00.000Z"),
};

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TestI18nProvider>
        <ChapterHistoryDialog chapter={chapter} novelId="novel-1" onOpenChange={onOpenChange} />
      </TestI18nProvider>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

afterEach(() => {
  cleanup();
  historyFunctions.listChapterTranslationVersions.mockReset();
  historyFunctions.getChapterTranslationVersion.mockReset();
  historyFunctions.restoreChapterTranslationVersion.mockReset();
  chapterFunctions.getChapter.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

/**
 * The screen's contract is what it compares: the selected generation against the text the
 * chapter holds now, which is the question "what would restoring this change" without asking
 * the reader to understand version numbering.
 */
describe("ChapterHistoryDialog", () => {
  it("compares the previous generation with the current text and restores it", async () => {
    historyFunctions.listChapterTranslationVersions.mockResolvedValue([NEWEST, PREVIOUS]);
    historyFunctions.getChapterTranslationVersion.mockResolvedValue({
      ...PREVIOUS,
      chapterId: chapter.id,
      content: "Old opening.\n\nShared paragraph.",
    });
    chapterFunctions.getChapter.mockResolvedValue({
      ...chapter,
      novelId: "novel-1",
      rawContent: "Raw.",
      translatedContent: "New opening.\n\nShared paragraph.",
      summary: null,
      sourceRevision: 1,
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
      updatedAt: new Date("2026-10-01T09:00:00.000Z"),
      canManage: true,
    });
    historyFunctions.restoreChapterTranslationVersion.mockResolvedValue({
      chapterId: chapter.id,
    });

    renderDialog();

    await waitFor(() => expect(screen.getByText("Manual edit")).toBeTruthy());
    expect(screen.getByText("Translation history — Chapter 1")).toBeTruthy();
    expect(screen.getByText("Translation")).toBeTruthy();

    await waitFor(() => expect(screen.getByText("Old opening.")).toBeTruthy());
    expect(screen.getByText("New opening.")).toBeTruthy();
    expect(screen.getByText("Shared paragraph.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(screen.getByText("Restore this translation?")).toBeTruthy());
    const confirm = screen
      .getAllByRole("button", { name: "Restore" })
      .find((button) => button.closest('[role="alertdialog"], [role="dialog"]'));
    expect(confirm).toBeTruthy();
    fireEvent.click(confirm as HTMLElement);

    await waitFor(() =>
      expect(historyFunctions.restoreChapterTranslationVersion).toHaveBeenCalledWith({
        data: { versionId: PREVIOUS.id },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("restores a version after a bulk delete cleared the chapter's translation", async () => {
    historyFunctions.listChapterTranslationVersions.mockResolvedValue([NEWEST]);
    historyFunctions.getChapterTranslationVersion.mockResolvedValue({
      ...NEWEST,
      chapterId: chapter.id,
      content: "The text the delete removed.\n\nSecond paragraph.",
    });
    // What the bulk delete leaves: no text, no translated status, no current version.
    chapterFunctions.getChapter.mockResolvedValue({
      ...chapter,
      translatedTitle: null,
      translatedContent: null,
      status: "raw",
      novelId: "novel-1",
      rawContent: "Raw.",
      summary: null,
      sourceRevision: 1,
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
      updatedAt: new Date("2026-10-01T09:00:00.000Z"),
      canManage: true,
    });
    historyFunctions.restoreChapterTranslationVersion.mockResolvedValue({
      chapterId: chapter.id,
    });

    renderDialog();

    // With no current text there is no diff to draw, so the version's own paragraphs are
    // shown as what restoring would put back, and the newest row is not claimed as current.
    await waitFor(() => expect(screen.getByText("The text the delete removed.")).toBeTruthy());
    expect(screen.getByText(/This chapter holds no translation right now/)).toBeTruthy();
    expect(screen.queryByText("Current")).toBeNull();

    const restoreButton = screen.getByRole("button", {
      name: "Restore this version",
    }) as HTMLButtonElement;
    expect(restoreButton.disabled).toBe(false);
    fireEvent.click(restoreButton);

    await waitFor(() => expect(screen.getByText("Restore this translation?")).toBeTruthy());
    expect(screen.getByText(/so this version puts its text back/)).toBeTruthy();
    const confirm = screen
      .getAllByRole("button", { name: "Restore" })
      .find((button) => button.closest('[role="alertdialog"], [role="dialog"]'));
    fireEvent.click(confirm as HTMLElement);

    await waitFor(() =>
      expect(historyFunctions.restoreChapterTranslationVersion).toHaveBeenCalledWith({
        data: { versionId: NEWEST.id },
      }),
    );
  });

  it("explains an empty trail instead of showing a blank list", async () => {
    historyFunctions.listChapterTranslationVersions.mockResolvedValue([]);
    chapterFunctions.getChapter.mockResolvedValue(null);

    renderDialog();

    await waitFor(() => expect(screen.getByText("No history yet")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Restore this version" })).toBeNull();
  });
});
