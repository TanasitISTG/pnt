// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NovelChapterList } from "./novel-chapter-list";
import type { ChapterRow } from "@/components/chapters/types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: { children: ReactNode; to?: unknown; params?: unknown } & Record<string, unknown>) => {
    void params;
    return createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children);
  },
}));

function createChapters(count: number): ChapterRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `chapter-${index + 1}`,
    number: String(index + 1),
    title: `Chapter ${index + 1}`,
    translatedTitle: null,
    hasTranslation: true,
    status: "translated",
    rawCharCount: 1000,
    publishedAt: null,
    editedAt: null,
  }));
}

function renderList(overrides: Partial<Parameters<typeof NovelChapterList>[0]> = {}) {
  return render(
    <NovelChapterList
      novelId="novel-1"
      chapters={createChapters(3)}
      readChapterIdSet={new Set()}
      currentChapterId={null}
      loading={false}
      canManage={false}
      {...overrides}
    />,
  );
}

/** Rows are addressed by title text: the link's name concatenates number and title. */
function chapterLink(title: string) {
  const titleNode = screen.getByText(title);
  const link = titleNode.closest("a");
  if (!link) throw new Error(`No chapter link wraps "${title}"`);
  return link;
}

afterEach(cleanup);

describe("NovelChapterList", () => {
  it("marks the chapters a reader has finished and the one they are in", () => {
    renderList({ readChapterIdSet: new Set(["chapter-1"]), currentChapterId: "chapter-2" });

    expect(within(chapterLink("Chapter 1")).getByText("Read")).toBeTruthy();
    expect(within(chapterLink("Chapter 2")).queryByText("Read")).toBeNull();
    expect(chapterLink("Chapter 2").getAttribute("aria-current")).toBe("page");
    expect(chapterLink("Chapter 1").getAttribute("aria-current")).toBeNull();
  });

  it("counts what the reader has read against the whole novel", () => {
    renderList({
      chapters: createChapters(4),
      readChapterIdSet: new Set(["chapter-1", "chapter-2"]),
    });

    expect(screen.getByText("2 of 4 read")).toBeTruthy();
  });

  it("groups a long novel by fifty and opens the group the reader is in", () => {
    renderList({ chapters: createChapters(120), currentChapterId: "chapter-101" });

    expect(
      screen.getByRole("button", { name: "Chapters 1–50 (50)" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Chapters 101–120 (20)" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Chapter 101")).toBeTruthy();
    expect(screen.queryByText("Chapter 1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Chapters 1–50 (50)" }));
    expect(chapterLink("Chapter 1")).toBeTruthy();
  });

  it("filters by number or title and recovers with the clear action", () => {
    renderList({ chapters: createChapters(120) });
    const searchBox = screen.getByRole("textbox", { name: "Search chapters" });

    fireEvent.change(searchBox, { target: { value: "119" } });

    // A search opens the groups it finds, so a match is never behind a collapsed header.
    expect(chapterLink("Chapter 119")).toBeTruthy();
    expect(screen.queryByText("Chapter 1")).toBeNull();

    fireEvent.change(searchBox, { target: { value: "nothing matches this" } });
    expect(screen.getByText("No chapters match this search.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear chapter search" }));
    expect(screen.getByRole("button", { name: "Chapters 1–50 (50)" })).toBeTruthy();
  });

  it("offers the owner a way to add chapters instead of an empty list", () => {
    renderList({ chapters: [], canManage: true });

    expect(screen.getByText("No chapters in this novel yet.")).toBeTruthy();
    // The empty state is an action, not a dead end: it opens the studio's add flow.
    expect(screen.getByRole("button", { name: "Add chapters" }).getAttribute("href")).toBe(
      "/novels/$novelId/manage/add",
    );
  });

  it("tells a reader that nothing is published yet", () => {
    renderList({ chapters: [], canManage: false });

    expect(screen.getByText("No chapters published yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add chapters" })).toBeNull();
  });
});
