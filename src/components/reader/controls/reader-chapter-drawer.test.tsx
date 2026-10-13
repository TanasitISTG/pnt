// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { ReaderChapterSummary } from "./reader-toolbar";
import { ReaderChapterDrawer } from "./reader-chapter-drawer";

const CHAPTERS: ReaderChapterSummary[] = Array.from({ length: 52 }, (_, index) => {
  const number = String(index + 1);
  return {
    id: `chapter-${number}`,
    number,
    title: `Source chapter ${number}`,
    translatedTitle: index === 50 ? "The long road home" : null,
  };
});
const CURRENT_CHAPTER = CHAPTERS[50]!;

function DrawerHarness({ onGoToChapter = () => undefined }: { onGoToChapter?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <ReaderChapterDrawer
      chapters={CHAPTERS}
      chapterId={CURRENT_CHAPTER.id}
      readChapterIdSet={new Set(["chapter-1"])}
      open={open}
      onOpenChange={setOpen}
      onGoToChapter={onGoToChapter}
      trigger={
        <Button variant="ghost" aria-label="Chapters">
          Chapters
        </Button>
      }
    />
  );
}

async function openDrawer(props: { onGoToChapter?: () => void } = {}) {
  render(<DrawerHarness {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Chapters" }));
  return within(await screen.findByRole("dialog"));
}

type DrawerScope = ReturnType<typeof within>;

/** The drawer opens on the current chapter's group; the rest stay collapsed. */
function expandGroup(drawer: DrawerScope, name: string) {
  const group = drawer.getByRole("button", { name });
  if (group.getAttribute("aria-expanded") !== "true") fireEvent.click(group);
}

/**
 * Rows are addressed by their title text rather than by an accessible-name pattern: the
 * name concatenates the number, the title and the read marker, and the title alone is
 * what a reader recognises.
 */
function chapterRow(drawer: DrawerScope, title: string) {
  const titleNode = drawer.getByText(title);
  const row = titleNode.closest("button");
  if (!row) throw new Error(`No chapter row wraps "${title}"`);
  return row;
}

afterEach(cleanup);

describe("ReaderChapterDrawer", () => {
  it("opens on the current chapter's group and marks it as the page", async () => {
    const drawer = await openDrawer();

    expect(drawer.getByRole("button", { name: "Chapters 1–50 (50)" })).toBeTruthy();
    expandGroup(drawer, "Chapters 51–52 (2)");

    const currentChapter = chapterRow(drawer, "The long road home");
    expect(currentChapter.getAttribute("aria-current")).toBe("page");
  });

  it("marks chapters the reader has finished", async () => {
    const drawer = await openDrawer();
    expandGroup(drawer, "Chapters 1–50 (50)");

    const readRow = chapterRow(drawer, "Source chapter 1");
    expect(within(readRow).getByText("Read")).toBeTruthy();
    const unreadRow = chapterRow(drawer, "Source chapter 2");
    expect(within(unreadRow).queryByText("Read")).toBeNull();
  });

  it("filters by number or title and recovers with the clear action", async () => {
    const drawer = await openDrawer();
    const searchBox = drawer.getByRole("textbox", { name: "Search chapters in picker" });

    fireEvent.change(searchBox, { target: { value: "long road" } });

    // A search opens its own single group, so the match is reachable without expanding.
    expect(chapterRow(drawer, "The long road home").getAttribute("aria-current")).toBe("page");
    expect(drawer.queryByText("Source chapter 1")).toBeNull();

    fireEvent.change(searchBox, { target: { value: "nothing matches this" } });
    expect(drawer.getByText("No chapters match your search.")).toBeTruthy();
    fireEvent.click(drawer.getByRole("button", { name: "Clear search" }));
    expandGroup(drawer, "Chapters 1–50 (50)");
    expect(chapterRow(drawer, "Source chapter 1")).toBeTruthy();
  });

  it("navigates to a chosen chapter and closes", async () => {
    const onGoToChapter = vi.fn();
    const drawer = await openDrawer({ onGoToChapter });
    expandGroup(drawer, "Chapters 1–50 (50)");

    fireEvent.click(chapterRow(drawer, "Source chapter 2"));

    expect(onGoToChapter).toHaveBeenCalledWith("chapter-2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
