// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TestI18nProvider } from "@/test/i18n";
import type { CatalogTag } from "@/lib/content/novel/catalog.types";

import { LibraryToolbar } from "./library-toolbar";
import { librarySearchSchema, type LibrarySearch } from "./library-search";

afterEach(cleanup);

const tags: CatalogTag[] = [
  { slug: "xianxia", name: "Xianxia", count: 12 },
  { slug: "slow-burn", name: "Slow burn", count: 4 },
];

function renderToolbar({
  search = librarySearchSchema.parse({}),
  isAdmin = false,
  onSearchChange = vi.fn(),
}: {
  search?: LibrarySearch;
  isAdmin?: boolean;
  onSearchChange?: (patch: Partial<LibrarySearch>) => void;
} = {}) {
  render(
    <TestI18nProvider>
      <LibraryToolbar
        search={search}
        tags={tags}
        isAdmin={isAdmin}
        resultCount={2}
        totalCount={9}
        onSearchChange={onSearchChange}
      />
    </TestI18nProvider>,
  );
  return { onSearchChange };
}

/**
 * The tag row is the catalog's vocabulary made actionable. What matters here is that a chip
 * is a *filter value* rather than a link, that choosing one replaces any other (one tag at a
 * time), and that choosing the active one clears it — the three things a reader does with it.
 */
describe("LibraryToolbar tags", () => {
  it("offers the vocabulary with its counts, all-tags first", () => {
    renderToolbar();

    const all = screen.getByRole("button", { name: "All tags" });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Xianxia/ }).textContent).toContain("12");
    expect(screen.getByRole("button", { name: /Slow burn/ })).toBeTruthy();
  });

  it("chooses one tag at a time and clears the active one", () => {
    const { onSearchChange } = renderToolbar();

    fireEvent.click(screen.getByRole("button", { name: /Xianxia/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ tag: "xianxia" });

    cleanup();
    const active = renderToolbar({
      search: librarySearchSchema.parse({ tag: "xianxia" }),
    });
    const pressed = screen.getByRole("button", { name: /Xianxia/ });
    expect(pressed.getAttribute("aria-pressed")).toBe("true");

    // Clicking the tag a reader is already filtered by takes the filter off.
    fireEvent.click(pressed);
    expect(active.onSearchChange).toHaveBeenCalledWith({ tag: "" });
  });

  it("renders no tag row when the vocabulary is empty", () => {
    render(
      <TestI18nProvider>
        <LibraryToolbar
          search={librarySearchSchema.parse({})}
          tags={[]}
          isAdmin={false}
          resultCount={0}
          totalCount={0}
          onSearchChange={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(screen.queryByRole("button", { name: "All tags" })).toBeNull();
  });
});
