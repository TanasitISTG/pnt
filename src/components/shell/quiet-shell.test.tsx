import { describe, expect, it } from "vitest";

import { hasPageFrame } from "./quiet-shell";

/**
 * Whether a layout is still standing around a page is the one decision the quiet pages get
 * wrong loudly: a second frame is a second header, a second footer and a second `<main>`
 * landmark on one screen. `ErrorPage` is the consumer, so the predicate is exercised here
 * for the match shapes the router actually produces.
 */
describe("hasPageFrame", () => {
  it("reports an unmatched address as unframed, since only the root route matches", () => {
    expect(hasPageFrame(["__root__"])).toBe(false);
    expect(hasPageFrame([])).toBe(false);
  });

  it("reports a page under either layout as framed", () => {
    expect(hasPageFrame(["__root__", "/_public"])).toBe(true);
    expect(hasPageFrame(["__root__", "/_public", "/_public/novels/$novelId"])).toBe(true);
    expect(hasPageFrame(["__root__", "/_protected", "/_protected/jobs"])).toBe(true);
  });

  it("ignores addresses that are not frames at all", () => {
    // `/browse` is a redirect and renders nothing; a sibling top-level page such as the
    // auth screens renders without a frame, which is why they carry one themselves.
    expect(hasPageFrame(["__root__", "/browse"])).toBe(false);
    expect(hasPageFrame(["__root__", "/login"])).toBe(false);
  });
});
