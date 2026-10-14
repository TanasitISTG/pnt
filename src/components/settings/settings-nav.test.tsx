// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The links render through TanStack Router, which this suite does not stand up: the nav's
 * contract is the set of destinations it names, so each `Link` is replaced by an anchor
 * that keeps its `to` — which is exactly what the nav is responsible for choosing.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} data-to={to} {...rest}>
      {children}
    </a>
  ),
}));

import { SettingsNav } from "./settings-nav";

afterEach(cleanup);

/** The nav's rendered labels, which is the contract each case below asserts on. */
const labels = () =>
  within(screen.getByRole("navigation", { name: "Settings sections" }))
    .getAllByRole("link")
    .map((link) => link.textContent);

describe("SettingsNav", () => {
  it("names every settings section an account owns, in the order the hub documents", () => {
    render(<SettingsNav />);

    expect(labels()).toEqual(["Account", "Provider", "Appearance", "Security"]);
  });

  it("keeps the operator-only Data section out of a reader's nav", () => {
    render(<SettingsNav />);

    expect(labels()).not.toContain("Data");
  });

  it("adds Data last for an operator", () => {
    render(<SettingsNav isAdmin />);

    expect(labels()).toEqual(["Account", "Provider", "Appearance", "Security", "Data"]);
  });

  it("points each section at its own URL, so every section is linkable", () => {
    render(<SettingsNav isAdmin />);

    const destinations = within(screen.getByRole("navigation", { name: "Settings sections" }))
      .getAllByRole("link")
      .map((link) => link.getAttribute("data-to"));

    expect(destinations).toEqual([
      "/settings/account",
      "/settings/provider",
      "/settings/appearance",
      "/settings/security",
      "/settings/data",
    ]);
  });
});
