// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The anchor keeps the props the router would have merged onto it, and drops the
// router-only ones; see `site-header.test.tsx` for the same stance.
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

import { AuthCard } from "./auth-card";

afterEach(cleanup);

describe("AuthCard", () => {
  it("names the screen with one first-level heading", () => {
    render(
      <AuthCard title="Create your account" description="Start translating.">
        <form />
      </AuthCard>,
    );

    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Create your account");
  });

  it("renders the quiet-page contract the bare auth screens used to be missing", () => {
    render(
      <AuthCard title="Sign in" description="Access your library.">
        <form />
      </AuthCard>,
    );

    // One landmark, reachable by the first focusable element, with the brand as the way
    // home and the legal links one tab away: an auth screen is a page like any other.
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe(
      "#main",
    );
    expect(screen.getByRole("link", { name: "Pnt" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeTruthy();
  });

  it("keeps the brand mark out of the accessibility tree", () => {
    render(
      <AuthCard title="Sign in" description="Access your library.">
        <form />
      </AuthCard>,
    );

    // The mark sits inside the named brand link, so an exposed image would announce the
    // same destination twice.
    expect(screen.queryByRole("img")).toBeNull();
  });
});
