// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ViewerUser } from "@/lib/profile/types";

import { SiteHeader } from "./site-header";

interface LinkLikeProps {
  children?: ReactNode;
  [key: string]: unknown;
}

// The anchor has to keep the props the router would have merged onto it — an `href` to
// carry the link role in jsdom, and the `role="button"` Base UI adds when a Button
// renders one, which is exactly what the specs address. Only the router-only props are
// dropped, because they would land on the DOM node as invalid attributes.
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

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/lib/use-hydrated", () => ({
  useHydrated: () => true,
}));

vi.mock("@/lib/profile/use-viewer-avatar", () => ({
  useViewerAvatar: () => null,
}));

// Signing out belongs to the shell's own test surface; this file is about which
// destinations the header offers.
vi.mock("./use-sign-out", () => ({
  useSignOut: () => ({ signingOut: false, signOut: vi.fn() }),
}));

const member = {
  id: "user-1",
  name: "E2E Admin",
  email: "e2e-admin@example.test",
} as unknown as ViewerUser;

afterEach(cleanup);

describe("SiteHeader navigation", () => {
  it("sends a guest to the shared catalog and never offers a shelf", () => {
    render(<SiteHeader user={null} />);

    expect(screen.getByRole("link", { name: "Catalog" })).toBeTruthy();
    // A guest owns no novels, so the shelf link is absent rather than dead.
    expect(screen.queryByRole("link", { name: "Library" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Jobs" })).toBeNull();
    // Both are links styled as buttons, which is how the specs address them.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });

  it("offers a signed-in account its shelf and jobs, with the account menu", () => {
    render(<SiteHeader user={member} />);

    expect(screen.getByRole("link", { name: "Catalog" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Library" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Jobs" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    // The account trigger is named by the account, which is how the profile specs find it.
    expect(screen.getByRole("button", { name: /E2E Admin/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appearance: Light" })).toBeTruthy();
  });

  it("opens the appearance menu with all three choices", async () => {
    render(<SiteHeader user={member} />);

    fireEvent.click(screen.getByRole("button", { name: "Appearance: Light" }));

    // The items are a Base UI radio group under a group label, and a label outside a
    // group throws while the popup renders — so reaching the choices at all is the
    // assertion that the menu is well-formed, not just that three labels exist.
    expect(await screen.findByRole("menuitemradio", { name: "Light" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "System" })).toBeTruthy();
  });
});
