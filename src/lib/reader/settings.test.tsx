// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { useReaderSettings } from "./settings";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

// The settings module keeps a module-level cache, so each case re-imports it fresh.
async function renderSettings() {
  vi.resetModules();
  const module = await import("./settings");
  return renderHook<ReturnType<typeof useReaderSettings>, unknown>(() =>
    module.useReaderSettings(),
  );
}

describe("reader settings", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
  });

  it("validates each stored setting and reports readiness after hydration", async () => {
    localStorage.setItem(
      "pnt-reader-settings",
      JSON.stringify({
        fontSize: "invalid",
        typeface: "reader",
        viewMode: "invalid",
        lineHeight: "huge",
        measure: "wide",
        pageTheme: "neon",
      }),
    );

    const { result } = await renderSettings();

    expect(result.current.ready).toBe(true);
    expect(result.current.settings).toEqual({
      fontSize: "M",
      typeface: "reader",
      viewMode: "side",
      lineHeight: "normal",
      measure: "wide",
      pageTheme: "app",
    });

    act(() => result.current.update({ fontSize: "XL" }));
    expect(JSON.parse(localStorage.getItem("pnt-reader-settings") ?? "{}")).toMatchObject({
      fontSize: "XL",
      typeface: "reader",
      viewMode: "side",
      lineHeight: "normal",
      measure: "wide",
      pageTheme: "app",
    });
  });

  it("defaults typography and page theme for settings stored before those fields existed", async () => {
    localStorage.setItem(
      "pnt-reader-settings",
      JSON.stringify({ fontSize: "L", typeface: "reader", viewMode: "translated" }),
    );

    const { result } = await renderSettings();

    expect(result.current.settings).toEqual({
      fontSize: "L",
      typeface: "reader",
      viewMode: "translated",
      lineHeight: "normal",
      measure: "medium",
      pageTheme: "app",
    });
  });

  it("persists each new control through the shared patch writer", async () => {
    const { result } = await renderSettings();

    act(() =>
      result.current.update({ lineHeight: "relaxed", measure: "narrow", pageTheme: "sepia" }),
    );

    expect(result.current.settings).toMatchObject({
      lineHeight: "relaxed",
      measure: "narrow",
      pageTheme: "sepia",
    });
    expect(JSON.parse(localStorage.getItem("pnt-reader-settings") ?? "{}")).toMatchObject({
      lineHeight: "relaxed",
      measure: "narrow",
      pageTheme: "sepia",
    });
  });
});
