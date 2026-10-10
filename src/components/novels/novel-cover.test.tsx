// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NovelCover } from "./novel-cover";

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isError: false }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("NovelCover in production", () => {
  it("serves the cover eagerly while keeping the alt text unpaintable", () => {
    vi.stubEnv("PROD", true);

    render(<NovelCover novelId="novel-1" coverVersion={123} alt="The Hidden Map" sizes="270px" />);

    const image = screen.getByAltText("The Hidden Map");
    expect(image.getAttribute("src")).toBe("/api/covers/novel-1?w=480&v=123");
    // Gecko paints alt text while the cover is still loading, so the element
    // must never render visible text.
    expect(image.className).toContain("text-transparent");
  });

  it("falls back to the placeholder when the cover fails", () => {
    vi.stubEnv("PROD", true);
    render(<NovelCover novelId={null} alt="The Hidden Map" sizes="270px" />);

    expect(screen.queryByAltText("The Hidden Map")).toBeNull();
  });

  it("replaces a cover that already failed before React could listen", () => {
    vi.stubEnv("PROD", true);
    const brokenImage = { complete: true, naturalWidth: 0 };
    const descriptors = (["complete", "naturalWidth"] as const).map(
      (property) =>
        [property, Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, property)] as const,
    );
    for (const [property, value] of Object.entries(brokenImage)) {
      Object.defineProperty(HTMLImageElement.prototype, property, {
        configurable: true,
        get: () => value,
      });
    }

    try {
      render(<NovelCover novelId="novel-1" alt="The Hidden Map" sizes="270px" />);
      expect(document.querySelector("img")).toBeNull();
    } finally {
      for (const [property, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(HTMLImageElement.prototype, property, descriptor);
      }
    }
  });
});
