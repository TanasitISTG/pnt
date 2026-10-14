// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The anchor keeps the props the router would have merged onto it — the `href` that carries
// the link role in jsdom, and the `role="button"` Base UI adds when a Button renders one,
// which is how the specs address these actions. See `site-header.test.tsx`.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    preload,
    viewTransition,
    activeProps,
    ...rest
  }: {
    children?: ReactNode;
    to?: unknown;
    params?: unknown;
    preload?: unknown;
    viewTransition?: unknown;
    activeProps?: unknown;
    [key: string]: unknown;
  }) => {
    void params;
    void preload;
    void viewTransition;
    void activeProps;
    return createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children);
  },
}));

import { NotFoundPage } from "./not-found-page";

afterEach(cleanup);

describe("NotFoundPage", () => {
  it("brings its own frame, because a not-found is resolved above every layout", () => {
    render(<NotFoundPage />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pnt" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeTruthy();
  });

  it("names the page once, in sentence case, with one way out", () => {
    render(<NotFoundPage />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("Page not found");
    // The code is decoration: the heading already says the page is missing.
    expect(screen.queryByRole("heading", { name: "404" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to catalog" }).getAttribute("href")).toBe(
      "/catalog",
    );
  });
});
