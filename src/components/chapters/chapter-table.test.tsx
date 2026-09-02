// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ChapterTable, type ChapterTableProps } from "./chapter-table";
import type { ChapterRow } from "./types";
import type { ActiveJobState } from "@/lib/translation/types/api";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));

vi.mock("@/components/publish-menu", () => ({
  PublishMenu: () => createElement("button", { type: "button" }, "Publishing options"),
}));

const CHAPTER: ChapterRow = {
  id: "chapter-1",
  number: "1",
  title: "Chapter One",
  translatedTitle: "บทที่หนึ่ง",
  status: "translated",
  rawCharCount: 1200,

  publishedAt: null,
  editedAt: null,
};
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);
const ACTIVE_JOB: ActiveJobState = {
  jobId: "job-1",
  chapterId: CHAPTER.id,
  status: "running",
  doneChunks: 1,
  totalChunks: 3,
};

function createProps(overrides: Partial<ChapterTableProps> = {}): ChapterTableProps {
  return {
    chapters: [CHAPTER],
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

describe("ChapterTable browsing behavior", () => {
  it("keeps title editing while omitting reorder handles", () => {
    const onStartEdit = vi.fn();
    const { rerender } = render(<ChapterTable {...createProps({ onStartEdit })} />);

    expect(
      screen.queryByRole("button", {
        name: "Reorder chapter 1: บทที่หนึ่ง",
      }),
    ).toBeNull();

    screen.getByRole("button", { name: "Edit chapter" }).click();
    expect(onStartEdit).toHaveBeenCalledWith(CHAPTER);

    rerender(
      <ChapterTable
        {...createProps({
          titleEdit: {
            chapterId: CHAPTER.id,
            translatedTitle: CHAPTER.translatedTitle ?? "",
            initialTranslatedTitle: CHAPTER.translatedTitle ?? "",
          },
        })}
      />,
    );
    expect(screen.getByLabelText("Translated title for chapter 1")).toBeTruthy();
  });
  it("shows foreign-script residue for admin rows", () => {
    render(
      <ChapterTable
        {...createProps({
          residualScriptMap: new Map([[CHAPTER.id, 13]]),
        })}
      />,
    );

    expect(screen.getByText("13 foreign-script letters")).toBeTruthy();
  });

  it("keeps translating rows disabled", () => {
    render(
      <ChapterTable
        {...createProps({
          activeJobs: new Map([[CHAPTER.id, ACTIVE_JOB]]),
          isTranslating: () => true,
        })}
      />,
    );

    expect(
      (screen.getByRole("checkbox", { name: "Select chapter 1" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Edit chapter" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
