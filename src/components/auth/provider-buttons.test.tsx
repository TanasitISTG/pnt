// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const socialSignIn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/auth-client", () => ({ signIn: { social: socialSignIn } }));

import { ProviderButtons } from "./provider-buttons";

afterEach(cleanup);

function renderButtons(overrides: Partial<ComponentProps<typeof ProviderButtons>> = {}) {
  return render(
    <ProviderButtons google discord callbackURL="/" onError={() => {}} {...overrides} />,
  );
}

/** True when `second` follows `first` in the document, which is how the marker leads its button. */
function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("ProviderButtons last-used marker", () => {
  /**
   * The marker has to name the control it is about, and it does that by attachment: one chip,
   * in the button's own row and immediately after it, pinned over that button's corner.
   */
  it("marks the provider used last, and only that one", () => {
    renderButtons({ lastUsedMethod: "discord" });

    const marker = screen.getByText("Last used");
    const google = screen.getByRole("button", { name: "Continue with Google" });
    const discord = screen.getByRole("button", { name: "Continue with Discord" });

    expect(screen.getAllByText("Last used")).toHaveLength(1);
    expect(marker.parentElement).toBe(discord.parentElement);
    expect(isBefore(discord, marker)).toBe(true);
    expect(marker.parentElement).not.toBe(google.parentElement);
  });

  it("marks nothing when the recorded method is a provider this deployment does not offer", () => {
    // A removed provider leaves a stale cookie behind; the page must not point at a button
    // that is not there.
    renderButtons({ google: false, lastUsedMethod: "google" });

    expect(screen.queryByText("Last used")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with Discord" })).toBeTruthy();
  });

  it("marks nothing for a password sign-in, which has no button here", () => {
    renderButtons({ lastUsedMethod: "email" });

    expect(screen.queryByText("Last used")).toBeNull();
  });

  it("keeps both providers available when there is no hint", () => {
    renderButtons({ lastUsedMethod: null });

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Discord" })).toBeTruthy();
    expect(screen.queryByText("Last used")).toBeNull();
  });
});
