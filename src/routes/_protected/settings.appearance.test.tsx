// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The account write is mocked for the same reason the login test mocks the session helpers:
 * importing it would pull the server graph into a DOM test. It never settles here, which
 * keeps the switch from reaching the reload — jsdom has no navigation, and the rule that
 * decides *where* a switch goes is the one `locales.test.ts` owns.
 */
const setViewerLocale = vi.hoisted(() => vi.fn(() => new Promise(() => {})));

/** The route module owns the wiring under test, so the router is mocked to one factory. */
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const route = { options: {} as { component?: React.ComponentType } };
  return {
    ...actual,
    createFileRoute: () => (options: { component?: React.ComponentType }) => {
      route.options = options;
      return route;
    },
  };
});

vi.mock("@/lib/account/locale.functions", () => ({ setViewerLocale }));

import { Route } from "@/routes/_protected/settings.appearance";

type RouteComponent = React.ComponentType & { preload?: () => Promise<unknown> };

async function renderAppearance() {
  const Page = (Route.options as { component: RouteComponent }).component;
  await Page.preload?.();
  return render(<Page />);
}

afterEach(() => {
  cleanup();
  setViewerLocale.mockClear();
  document.cookie = "pnt-locale=; Max-Age=0; Path=/";
});

describe("appearance settings language choice", () => {
  /**
   * Settings is the second surface that offers the choice — the header's menu is the other —
   * and it is the one a reader goes looking for, so the control has to be here, named, and
   * have each language written in its own language.
   */
  it("offers both languages, with the one being read marked", async () => {
    await renderAppearance();

    expect(screen.getByRole("group", { name: "Language" })).toBeTruthy();
    // The suite runs pinned to English (i18n.md §7), so English is the current choice.
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "ไทย" }).getAttribute("aria-pressed")).toBe("false");
    // The card says what the choice does and does not change.
    expect(screen.getByText(/not the language of a novel's translation/i)).toBeTruthy();
  });

  it("records the choice in the cookie and on the account", async () => {
    await renderAppearance();

    fireEvent.click(screen.getByRole("button", { name: "ไทย" }));

    // The cookie is written for every reader, signed in or not, and it is what makes the
    // choice hold for this browser before the account ever hears about it.
    expect(document.cookie).toContain("pnt-locale=th");
    expect(setViewerLocale).toHaveBeenCalledWith({ data: { locale: "th" } });
  });
});
