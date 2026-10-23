// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ChapterTable, type ChapterTableProps } from "./chapter-table";
import type { ChapterRow } from "@/components/chapters/types";
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
  hasTranslation: true,
  hasHistory: true,
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
    publicationBlockMap: new Map(),
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
    onViewHistory: vi.fn(),
    titleEdit: null,
    onSaveTitle: vi.fn().mockResolvedValue(undefined),
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
            initialTranslatedTitle: CHAPTER.translatedTitle ?? "",
          },
        })}
      />,
    );
    expect(screen.getByLabelText("Translated title for chapter 1")).toBeTruthy();
  });
  it("enables the inline title save only once the draft differs from the stored title", () => {
    render(
      <ChapterTable
        {...createProps({
          titleEdit: {
            chapterId: CHAPTER.id,
            initialTranslatedTitle: CHAPTER.translatedTitle ?? "",
          },
        })}
      />,
    );

    const saveButton = screen.getByRole("button", {
      name: "Save translated title",
    }) as HTMLButtonElement;
    const input = screen.getByLabelText("Translated title for chapter 1") as HTMLInputElement;
    expect(saveButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "บทที่หนึ่งแก้ไข" } });

    expect(saveButton.disabled).toBe(false);
  });

  it("routes translated chapters through explicit retranslation confirmation", () => {
    const onStartTranslate = vi.fn();
    const onRequestRetranslate = vi.fn();

    render(<ChapterTable {...createProps({ onStartTranslate, onRequestRetranslate })} />);

    screen.getByRole("button", { name: "Re-translate chapter" }).click();

    expect(onRequestRetranslate).toHaveBeenCalledWith(CHAPTER.id);
    expect(onStartTranslate).not.toHaveBeenCalled();
  });
  it("keeps the history trail reachable after the translations were cleared", () => {
    const onViewHistory = vi.fn();
    // What a bulk delete leaves behind: no text, no translated status, and a row that would
    // otherwise offer nothing at all — while the trail is exactly the way back.
    const cleared: ChapterRow = {
      ...CHAPTER,
      translatedTitle: null,
      hasTranslation: false,
      hasHistory: true,
      status: "raw",
    };

    render(<ChapterTable {...createProps({ chapters: [cleared], onViewHistory })} />);

    screen.getByRole("button", { name: "Translation history" }).click();
    expect(onViewHistory).toHaveBeenCalledWith(cleared.id);
  });

  it("shows no history action on a chapter that was never translated", () => {
    const never: ChapterRow = {
      ...CHAPTER,
      translatedTitle: null,
      hasTranslation: false,
      hasHistory: false,
      status: "raw",
    };

    render(<ChapterTable {...createProps({ chapters: [never] })} />);

    expect(screen.queryByRole("button", { name: "Translation history" })).toBeNull();
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

  it("marks a row the publish pre-flight refuses, and keeps publishing reachable", () => {
    render(
      <ChapterTable
        {...createProps({
          publicationBlockMap: new Map([
            [CHAPTER.id, [{ reason: "missing-paragraphs", missingParagraphs: 1 }]],
          ]),
        })}
      />,
    );

    expect(screen.getByText("1 paragraph missing")).toBeTruthy();
    // The server is the authority: the control stays available so a refusal can be explained
    // rather than silently hidden behind a stale readiness cache.
    expect(screen.getByRole("button", { name: "Publishing options" })).toBeTruthy();
  });

  it("says a live chapter is at risk instead of naming a paragraph count", () => {
    render(
      <ChapterTable
        {...createProps({
          chapters: [{ ...CHAPTER, publishedAt: "2000-01-01T00:00:00.000Z" }],
          publicationBlockMap: new Map([[CHAPTER.id, [{ reason: "run-incomplete" }]]]),
        })}
      />,
    );

    expect(screen.getByText("Live · needs attention")).toBeTruthy();
  });

  it("allows selecting translating rows while keeping edit actions disabled", () => {
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
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Edit chapter" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
