// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

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

const mocks = vi.hoisted(() => {
  let releaseImport!: () => void;
  const importGate = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });

  return {
    importGate,
    releaseImport,
    posthog: {
      init: vi.fn(),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
      captureException: vi.fn(),
    },
  };
});

vi.mock("posthog-js", async () => {
  await mocks.importGate;
  return { default: mocks.posthog };
});

import { setConsent } from "./consent";
import { captureException, updatePostHogConsent } from "./posthog";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PostHog consent", () => {
  it("lets revocation block in-flight initialization and permits a later granted retry", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_PUBLIC_POSTHOG_KEY", "test-project-key");
    const storage = new MemoryStorage();
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    setConsent("granted");

    const error = new Error("private detail");
    const initialConsentUpdate = updatePostHogConsent("granted");
    captureException(error);

    setConsent("denied");
    await updatePostHogConsent("denied");
    mocks.releaseImport();
    await initialConsentUpdate;
    await Promise.resolve();

    expect(mocks.posthog.init).not.toHaveBeenCalled();
    expect(mocks.posthog.opt_in_capturing).not.toHaveBeenCalled();
    expect(mocks.posthog.captureException).not.toHaveBeenCalled();

    setConsent("granted");
    await updatePostHogConsent("granted");

    expect(mocks.posthog.init).toHaveBeenCalledOnce();
    expect(mocks.posthog.opt_in_capturing).toHaveBeenCalledOnce();

    captureException(error);
    await vi.waitFor(() => {
      expect(mocks.posthog.captureException).toHaveBeenCalledWith(error);
    });
  });
});
