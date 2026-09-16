// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NovelHeader, type NovelHeaderProps } from "./novel-header";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", null, children),
}));

vi.mock("@/components/novels/novel-cover", () => ({
  NovelCover: ({ alt }: { alt?: string }) => createElement("img", { alt: alt ?? "" }),
}));

vi.mock("@/components/publish-menu", () => ({
  PublishMenu: () => createElement("button", { type: "button" }, "Publishing options"),
}));

const DESCRIPTION_LIMIT = 240;
const SHORT_DESCRIPTION = "s".repeat(DESCRIPTION_LIMIT);
const LONG_DESCRIPTION = `${"l".repeat(DESCRIPTION_LIMIT)}!`;

const BASE_NOVEL: NovelHeaderProps["novel"] = {
  id: "novel-1",
  title: "The Hidden Map",
  originalTitle: null,
  author: null,
  description: null,
  sourceLang: "zh",
  targetLang: "th",
  customPrompt: null,
  chunkSize: 1000,
  contextTailLength: 3,
  publishedAt: null,
  hasCover: false,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

function renderNovelHeader(description: string): void {
  render(
    <NovelHeader
      novel={{ ...BASE_NOVEL, description }}
      novelId={BASE_NOVEL.id}
      isAdmin={false}
      glossaryStats={undefined}
      costData={undefined}
      chapters={[]}
      chaptersPending={false}
      readingActionsPending={false}
      lastReadChapter={null}
      firstChapter={null}
      exporting={null}
      publishingNovel={false}
      onPublishNovel={() => undefined}
      onExportTxt={() => undefined}
      onExportEpub={() => undefined}
      onDeleteNovel={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("NovelHeader description", () => {
  it("shows descriptions at the 240-character limit without a synopsis disclosure", () => {
    renderNovelHeader(SHORT_DESCRIPTION);

    const description = screen.getByText(SHORT_DESCRIPTION);

    expect(description.hidden).toBe(false);
    expect(screen.queryByText("Synopsis")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  });

  it("expands and collapses descriptions longer than 240 characters with the Collapsible trigger", () => {
    renderNovelHeader(LONG_DESCRIPTION);

    const preview = screen.getByText(LONG_DESCRIPTION);
    expect(preview.hidden).toBe(false);
    expect(screen.queryByText("Synopsis")).toBeNull();

    const showMore = screen.getByRole("button", { name: "Show more" });
    expect(showMore.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(showMore);

    const showLess = screen.getByRole("button", { name: "Show less" });
    expect(showLess.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    const contentId = showLess.getAttribute("aria-controls");
    expect(contentId).toBeTruthy();

    const content = document.getElementById(contentId!);
    expect(content).not.toBeNull();
    expect(content?.hidden).toBe(false);
    expect(content?.textContent).toContain(LONG_DESCRIPTION);

    fireEvent.click(showLess);

    const collapsedShowMore = screen.getByRole("button", { name: "Show more" });
    expect(collapsedShowMore.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
    expect(document.getElementById(contentId!)).toBeNull();
    expect(screen.getByText(LONG_DESCRIPTION).hidden).toBe(false);
  });
});
