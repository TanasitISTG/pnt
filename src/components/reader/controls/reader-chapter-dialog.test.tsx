// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

import type { ReaderChapterSummary } from "./reader-toolbar";
import { ReaderChapterDialog } from "./reader-chapter-dialog";

const LONG_CURRENT_TITLE =
  "A chapter title long enough to make the picker trigger overflow if it renders visible text";
const CHAPTERS: ReaderChapterSummary[] = Array.from({ length: 52 }, (_, index) => {
  const number = String(index + 1);
  return {
    id: `chapter-${number}`,
    number,
    title: `Source chapter ${number}`,
    translatedTitle: index === 50 ? LONG_CURRENT_TITLE : null,
  };
});
const CURRENT_CHAPTER = CHAPTERS[50]!;

function ReaderChapterDialogHarness() {
  const [open, setOpen] = useState(false);

  return (
    <ReaderChapterDialog
      chapters={CHAPTERS}
      chapterId={CURRENT_CHAPTER.id}
      open={open}
      onOpenChange={setOpen}
      onGoToChapter={() => undefined}
    />
  );
}

afterEach(cleanup);

describe("ReaderChapterDialog", () => {
  it("keeps the picker icon-only while preserving accessible chapter navigation", async () => {
    render(<ReaderChapterDialogHarness />);

    const trigger = screen.getByRole("button", {
      name: `Choose chapter: Ch. ${CURRENT_CHAPTER.number} — ${LONG_CURRENT_TITLE}`,
    });
    expect(trigger.textContent).not.toContain(LONG_CURRENT_TITLE);
    expect(trigger.textContent).not.toContain(`Ch. ${CURRENT_CHAPTER.number}`);
    expect(trigger.textContent).not.toContain(CURRENT_CHAPTER.number);
    expect(trigger.textContent).not.toContain("Chapters");

    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Chapters 1–50 (50)" })).toBeTruthy();
    const currentGroup = within(dialog).getByRole("button", { name: "Chapters 51–52 (2)" });
    if (currentGroup.getAttribute("aria-expanded") !== "true") fireEvent.click(currentGroup);

    const currentChapter = await within(dialog).findByRole("button", {
      name: new RegExp(LONG_CURRENT_TITLE),
    });
    expect(currentChapter.getAttribute("aria-current")).toBe("page");
  });
});
