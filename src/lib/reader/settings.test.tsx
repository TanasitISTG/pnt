// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useReaderSettings } from "./settings";

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

  it("validates each stored setting and reports readiness after hydration", () => {
    localStorage.setItem(
      "pnt-reader-settings",
      JSON.stringify({ fontSize: "invalid", typeface: "reader", viewMode: "invalid" }),
    );

    const { result } = renderHook(() => useReaderSettings());

    expect(result.current.ready).toBe(true);
    expect(result.current.settings).toEqual({
      fontSize: "M",
      typeface: "reader",
      viewMode: "side",
    });

    act(() => result.current.update({ fontSize: "XL" }));
    expect(JSON.parse(localStorage.getItem("pnt-reader-settings") ?? "{}")).toMatchObject({
      fontSize: "XL",
      typeface: "reader",
      viewMode: "side",
    });
  });
});
