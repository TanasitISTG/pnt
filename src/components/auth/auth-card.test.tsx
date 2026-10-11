// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

  it("keeps the decorative mark out of the accessibility tree", () => {
    render(
      <AuthCard title="Sign in" description="Access your library.">
        <form />
      </AuthCard>,
    );

    // The mark sits directly above the heading, so an accessible image would
    // announce the same page twice.
    expect(screen.queryByRole("img")).toBeNull();
  });
});
