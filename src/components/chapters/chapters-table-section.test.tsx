// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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
    residualHanziMap: new Map(),
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

describe("ChaptersTableSection", () => {
  it("mounts one authenticated 50-chapter group at a time", async () => {
    const chapters = createChapters(120);
    const onToggleSelectAll = vi.fn();

    render(
      <ChaptersTableSection
        chapters={chapters}
        isAdmin
        loading={false}
        tableProps={createTableProps({ onToggleSelectAll })}
      />,
    );

    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(screen.getByText("Chapter 1")).toBeTruthy();
    expect(screen.queryByText("Chapter 51")).toBeNull();

    screen.getByRole("button", { name: "Chapters 51–100 (50)" }).click();

    await waitFor(() => {
      expect(screen.getAllByRole("row")).toHaveLength(51);
      expect(screen.queryByText("Chapter 1")).toBeNull();
      expect(screen.getByText("Chapter 51")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all chapters" }));
    expect(onToggleSelectAll).toHaveBeenCalledWith(
      chapters.slice(50, 100).map((chapter) => chapter.id),
      true,
    );
  });
});
