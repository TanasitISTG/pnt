// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChaptersTableSection } from "./chapters-table-section";
import type { ChapterTableProps } from "./chapter-table";
import type { ChapterRow } from "./types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));

vi.mock("@/components/publish-menu", () => ({
  PublishMenu: () => createElement("button", { type: "button" }, "Publishing options"),
}));

function createChapters(count: number): ChapterRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `chapter-${index + 1}`,
    number: String(index + 1),
    title: `Chapter ${index + 1}`,
    translatedTitle: null,
    status: "raw",
    rawCharCount: 1000,
    publishedAt: null,
    editedAt: null,
  }));
}

function createTableProps(
  overrides: Partial<Omit<ChapterTableProps, "chapters">> = {},
): Omit<ChapterTableProps, "chapters"> {
  return {
    novelId: "novel-1",
    isAdmin: true,
    activeJobs: new Map(),
    readChapterIdSet: new Set(),
    residualScriptMap: new Map(),
    costData: undefined,
    selectedIds: new Set(),
    isTranslating: () => false,
    onToggleSelect: vi.fn(),
    onToggleSelectAll: vi.fn(),
    publishingChapterId: null,
    onPublishChapter: vi.fn(),
    onCancelTranslate: vi.fn(),
    onRetryTranslate: vi.fn(),
    onStartTranslate: vi.fn(),
    onRequestRetranslate: vi.fn(),
    onViewLogs: vi.fn(),
    titleEdit: null,
    editErrors: {},
    onSaveTitle: vi.fn(),
    savingTitle: false,
    onTitleChange: vi.fn(),
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onDeleteChapter: vi.fn(),
    ...overrides,
  };
}

function SelectableChapterHarness({
  chapters,
  initialChapterId,
}: {
  chapters: ChapterRow[];
  initialChapterId?: string | null;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const onToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const onToggleSelectAll = (ids: string[], checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  return (
    <>
      <output aria-label="Selected chapter count">{selectedIds.size}</output>
      <ChaptersTableSection
        chapters={chapters}
        isAdmin
        loading={false}
        tableProps={createTableProps({
          selectedIds,
          isTranslating: (chapterId) => chapterId === "chapter-60",
          onToggleSelect,
          onToggleSelectAll,
        })}
        initialChapterId={initialChapterId}
      />
    </>
  );
}

afterEach(cleanup);

describe("ChaptersTableSection", () => {
  it("selects every row in a visible group, including translating rows", async () => {
    const chapters = createChapters(120);

    render(<SelectableChapterHarness chapters={chapters} />);
    fireEvent.click(screen.getByRole("button", { name: "Chapters 51–100 (50)" }));
    await waitFor(() => expect(screen.queryByText("Chapter 1")).toBeNull());

    const translating = screen.getByRole("checkbox", {
      name: "Select chapter 60",
    }) as HTMLInputElement;
    expect(translating.disabled).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select visible chapters" }));
    await waitFor(() => {
      expect(
        (screen.getByRole("checkbox", { name: "Select chapter 51" }) as HTMLInputElement).checked,
      ).toBe(true);
    });
    expect(translating.checked).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Select chapter 100" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(screen.getByLabelText("Selected chapter count").textContent).toBe("50");

    fireEvent.click(screen.getByRole("button", { name: "Chapters 1–50 (50)" }));
    await waitFor(() => expect(screen.queryByText("Chapter 51")).toBeNull());
    expect(
      (screen.getByRole("checkbox", { name: "Select chapter 1" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByLabelText("Selected chapter count").textContent).toBe("50");
  }, 15_000);

  it("adopts late resume groups until the user explicitly chooses a group", async () => {
    const chapters = createChapters(120);
    const view = render(
      <SelectableChapterHarness chapters={chapters} initialChapterId={undefined} />,
    );

    expect(screen.getAllByText("Chapter 1").length).toBeGreaterThan(0);
    view.rerender(<SelectableChapterHarness chapters={chapters} initialChapterId="chapter-75" />);
    await waitFor(() => expect(screen.queryByText("Chapter 1")).toBeNull());
    expect(screen.getAllByText("Chapter 75").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Chapters 1–50 (50)" }));
    await waitFor(() => expect(screen.queryByText("Chapter 75")).toBeNull());
    expect(screen.getByText("Chapter 1")).toBeTruthy();

    view.rerender(<SelectableChapterHarness chapters={chapters} initialChapterId="chapter-115" />);
    expect(screen.getByText("Chapter 1")).toBeTruthy();
    expect(screen.queryByText("Chapter 101")).toBeNull();
  }, 15_000);
});
