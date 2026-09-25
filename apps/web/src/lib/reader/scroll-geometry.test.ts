// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getReaderScrollFraction,
  getReaderScrollRange,
  getReaderTopInset,
} from "./scroll-geometry";

const VIEWPORT_HEIGHT = 1000;

function rectFor(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function createProse({ top, bottom }: { top: number; bottom: number }) {
  const prose = document.createElement("div");
  prose.getBoundingClientRect = () => rectFor(top - window.scrollY, bottom - window.scrollY);
  document.body.append(prose);
  return prose;
}

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value });
}

describe("getReaderScrollRange", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: VIEWPORT_HEIGHT,
    });
    setScrollY(0);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("excludes the app footer by measuring the prose against the pinned toolbar", () => {
    const prose = createProse({ top: 200, bottom: 3200 });

    expect(getReaderScrollRange(prose, 80)).toEqual({
      start: 120,
      end: 2200,
      scrollable: true,
    });
  });

  it("reports a fitting chapter as not scrollable with equal bounds", () => {
    const prose = createProse({ top: 200, bottom: 700 });

    expect(getReaderScrollRange(prose, 80)).toEqual({
      start: 120,
      end: 120,
      scrollable: false,
    });
  });

  it("clamps the start of prose that begins above the toolbar", () => {
    const prose = createProse({ top: 40, bottom: 3200 });

    expect(getReaderScrollRange(prose, 80)).toMatchObject({ start: 0, scrollable: true });
  });

  it("keeps the range stable while the reader scrolls", () => {
    const prose = createProse({ top: 200, bottom: 3200 });
    setScrollY(1500);

    expect(getReaderScrollRange(prose, 80)).toEqual({
      start: 120,
      end: 2200,
      scrollable: true,
    });
  });
});

describe("getReaderScrollFraction", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: VIEWPORT_HEIGHT,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("maps the prose bounds onto 0 and 1", () => {
    const prose = createProse({ top: 200, bottom: 3200 });

    setScrollY(120);
    expect(getReaderScrollFraction(prose, 80)).toBe(0);

    setScrollY(1160);
    expect(getReaderScrollFraction(prose, 80)).toBe(0.5);

    setScrollY(2200);
    expect(getReaderScrollFraction(prose, 80)).toBe(1);
  });

  it("clamps scrolling into the footer to a full fraction", () => {
    const prose = createProse({ top: 200, bottom: 3200 });

    setScrollY(3200);
    expect(getReaderScrollFraction(prose, 80)).toBe(1);
  });

  it("has no fraction for prose that fits the viewport", () => {
    const prose = createProse({ top: 200, bottom: 700 });

    expect(getReaderScrollFraction(prose, 80)).toBeNull();
  });
});

describe("getReaderTopInset", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("adds the pinned offset to the toolbar height", () => {
    const toolbar = document.createElement("header");
    toolbar.getBoundingClientRect = () => rectFor(0, 64);
    document.body.append(toolbar);
    // jsdom does not resolve the sticky `top` the real toolbar carries, so the computed
    // offset is stubbed here; the height is measured for real.
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ top: "8px" } as CSSStyleDeclaration);

    expect(getReaderTopInset(toolbar)).toBe(72);
  });

  it("treats an unpinned toolbar as a zero offset", () => {
    const toolbar = document.createElement("header");
    toolbar.getBoundingClientRect = () => rectFor(0, 64);
    document.body.append(toolbar);

    expect(getReaderTopInset(toolbar)).toBe(64);
  });
});
