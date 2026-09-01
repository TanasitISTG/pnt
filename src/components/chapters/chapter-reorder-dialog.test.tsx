// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useState } from "react";
import { ChapterReorderDialog } from "./chapter-reorder-dialog";
import type { ChapterRow } from "./types";

const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const CHAPTERS: ChapterRow[] = [
  {
    id: "chapter-1",
    number: "1",
    title: "Source one",
    translatedTitle: null,
    status: "raw",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
  {
    id: "chapter-2",
    number: "2",
    title: "Source two",
    translatedTitle: null,
    status: "raw",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
  {
    id: "chapter-3",
    number: "3",
    title: "Source three",
    translatedTitle: null,
    status: "raw",
    rawCharCount: 100,
    publishedAt: null,
    editedAt: null,
  },
];

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
  HTMLElement.prototype.getBoundingClientRect = function () {
    const item = this.closest<HTMLElement>('[data-slot="sortable-item"]');
    if (item) {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="sortable-item"]'),
      );
      const index = items.indexOf(item);
      const top = index * 40;
      return {
        bottom: top + 32,
        height: 32,
        left: 0,
        right: 320,
        top,
        width: 320,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return realGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
});
afterEach(cleanup);

function ControlledDialog({
  onSave,
  onOpenChange,
}: {
  onSave: (chapterIds: string[]) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    setOpen(nextOpen);
  };

  return open ? (
    <ChapterReorderDialog
      chapters={CHAPTERS}
      saving={false}
      onOpenChange={handleOpenChange}
      onSave={onSave}
    />
  ) : (
    <button type="button" onClick={() => setOpen(true)}>
      Reopen
    </button>
  );
}

function renderDialog(onSave: (chapterIds: string[]) => Promise<unknown>) {
  const onOpenChange = vi.fn();
  const result = render(<ControlledDialog onSave={onSave} onOpenChange={onOpenChange} />);
  return { ...result, onOpenChange };
}

async function waitForSortableList() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Reorder chapter 1: Source one" })).toBeTruthy();
  });
}

async function keyboardMoveThirdToFirst() {
  const thirdHandle = screen.getByRole("button", {
    name: "Reorder chapter 3: Source three",
  });
  thirdHandle.focus();
  fireEvent.keyDown(thirdHandle, { code: "Space", key: " " });
  expect(document.querySelector('[data-slot="sortable"][data-dragging="true"]')).toBeTruthy();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  fireEvent.keyDown(thirdHandle, { code: "ArrowUp", key: "ArrowUp" });
  fireEvent.keyDown(thirdHandle, { code: "ArrowUp", key: "ArrowUp" });
  fireEvent.keyDown(thirdHandle, { code: "Space", key: " " });
}

function sortableTitles() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="sortable-item"]')).map(
    (item) => item.textContent?.trim(),
  );
}

describe("ChapterReorderDialog", () => {
  it("paints preparation before mounting the sortable list", async () => {
    renderDialog(vi.fn().mockResolvedValue(undefined));

    expect(screen.getByText("Preparing 3 chapters…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reorder chapter 1: Source one" })).toBeNull();

    await waitForSortableList();
  });

  it("discards local changes when canceled and cannot save unchanged order", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { onOpenChange } = renderDialog(onSave);
    await waitForSortableList();

    await keyboardMoveThirdToFirst();
    await waitFor(() => expect(sortableTitles()[0]).toContain("Source three"));

    screen.getByRole("button", { name: "Cancel" }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
    });
    screen.getByRole("button", { name: "Reopen" }).click();
    await waitForSortableList();
    expect(sortableTitles()[0]).toContain("Source one");

    const saveButton = screen.getByRole("button", { name: "Save order" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    saveButton.click();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("submits the complete changed order once and closes after saving", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDialog(onSave);
    await waitForSortableList();

    await keyboardMoveThirdToFirst();
    await waitFor(() => expect(sortableTitles()[0]).toContain("Source three"));

    screen.getByRole("button", { name: "Save order" }).click();
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(["chapter-3", "chapter-1", "chapter-2"]);
    });
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Reorder chapters" })).toBeNull(),
    );
  });

  it("keeps the dialog open when saving rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("stale order"));
    renderDialog(onSave);
    await waitForSortableList();

    await keyboardMoveThirdToFirst();
    await waitFor(() => expect(sortableTitles()[0]).toContain("Source three"));

    screen.getByRole("button", { name: "Save order" }).click();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Reorder chapters" })).toBeTruthy();
  });
});
