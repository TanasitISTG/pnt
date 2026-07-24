import { beforeEach, describe, expect, it } from "vitest";

import { getConsent, setConsent } from "./consent";

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

describe("consent module", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    const mockWindow = {
      localStorage: storage,
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.window = mockWindow as unknown as Window & typeof globalThis;
    globalThis.localStorage = storage;
  });

  it("defaults getConsent to pending when no value stored", () => {
    expect(getConsent()).toBe("pending");
  });

  it("returns stored consent state when valid", () => {
    localStorage.setItem("pnt-consent-v1", "granted");
    expect(getConsent()).toBe("granted");

    localStorage.setItem("pnt-consent-v1", "denied");
    expect(getConsent()).toBe("denied");
  });

  it("returns pending if stored value is invalid", () => {
    localStorage.setItem("pnt-consent-v1", "invalid-value");
    expect(getConsent()).toBe("pending");
  });

  it("saves consent via setConsent", () => {
    setConsent("granted");
    expect(localStorage.getItem("pnt-consent-v1")).toBe("granted");
  });
});
