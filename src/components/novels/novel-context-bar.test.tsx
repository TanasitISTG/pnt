// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NovelContextBar } from "./novel-context-bar";

interface LinkLikeProps {
  children?: ReactNode;
  [key: string]: unknown;
}

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    preload,
    viewTransition,
    activeProps,
    ...rest
  }: LinkLikeProps) => {
    void params;
    void preload;
    void viewTransition;
    void activeProps;
    return createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children);
  },
}));

vi.mock("@/lib/use-hydrated", () => ({
  useHydrated: () => true,
}));

afterEach(cleanup);

const baseProps = {
  novelId: "novel-1",
  title: "The Long Road",
  sourceLang: "en",
  targetLang: "th",
};

describe("NovelContextBar", () => {
  it("places a reader in the catalog with the language pair as one phrase", () => {
    render(<NovelContextBar {...baseProps} canManage={false} />);

    const trail = screen.getByRole("navigation", { name: "Novel" });
    expect(trail.textContent).toContain("Catalog");
    expect(screen.getByText("EN to TH")).toBeTruthy();
    // A reader is never offered the studio, and no publish control is invented for them.
    expect(screen.queryByRole("button", { name: "Manage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Novel publishing options" })).toBeNull();
  });

  it("gives the owner their shelf as the origin, publish state and the studio door", () => {
    render(
      <NovelContextBar
        {...baseProps}
        canManage
        publishedAt={null}
        onPublishChange={vi.fn()}
        origin="library"
      />,
    );

    const trail = screen.getByRole("navigation", { name: "Novel" });
    expect(trail.textContent).toContain("Your Library");
    expect(screen.getByRole("button", { name: "Novel publishing options" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage" })).toBeTruthy();
  });

  it("marks the novel as the current page only when the novel is the page", () => {
    const { unmount } = render(<NovelContextBar {...baseProps} canManage={false} />);
    expect(screen.getByRole("link", { name: "The Long Road" }).getAttribute("aria-current")).toBe(
      "page",
    );
    unmount();

    // In the studio the sub-nav owns `aria-current`, so the trail's novel link must not
    // claim it too.
    render(<NovelContextBar {...baseProps} canManage current="manage" />);
    expect(screen.getByRole("link", { name: "The Long Road" }).getAttribute("aria-current")).toBe(
      null,
    );
  });
});
