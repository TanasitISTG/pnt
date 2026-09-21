// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoverUpload } from "./cover-upload";

const mocks = vi.hoisted(() => ({
  blobToDataUrl: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  blobToDataUrl: mocks.blobToDataUrl,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

class ControlledImage {
  static instances: ControlledImage[] = [];

  naturalWidth = 1_200;
  naturalHeight = 1_800;
  src = "";
  private listeners = {
    load: new Set<EventListener>(),
    error: new Set<EventListener>(),
  };

  constructor() {
    ControlledImage.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if ((type === "load" || type === "error") && typeof listener === "function") {
      this.listeners[type].add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if ((type === "load" || type === "error") && typeof listener === "function") {
      this.listeners[type].delete(listener);
    }
  }

  capture(type: "load" | "error"): EventListener {
    const listener = this.listeners[type].values().next().value;
    if (!listener) throw new Error(`Missing ${type} listener`);
    return listener;
  }

  emit(type: "load" | "error"): void {
    for (const listener of this.listeners[type]) listener(new Event(type));
  }
}

function renderCover(onChange = vi.fn(), cover?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CoverUpload cover={cover} onChange={onChange} />
    </QueryClientProvider>,
  );
  const input = view.container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing cover input");
  return { ...view, input, onChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  ControlledImage.instances = [];
  vi.stubGlobal("Image", ControlledImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/webp;base64,processed-b",
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CoverUpload operation ordering", () => {
  it("keeps selection B when it completes before selection A", async () => {
    const readA = Promise.withResolvers<string>();
    const readB = Promise.withResolvers<string>();
    mocks.blobToDataUrl.mockImplementation((file: File) =>
      file.name === "a.png" ? readA.promise : readB.promise,
    );
    const { input, onChange } = renderCover();

    fireEvent.change(input, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    const imageA = ControlledImage.instances[0];
    const staleLoad = imageA.capture("load");
    const staleError = imageA.capture("error");

    fireEvent.change(input, {
      target: { files: [new File(["b"], "b.png", { type: "image/png" })] },
    });
    const imageB = ControlledImage.instances[1];

    await act(async () => {
      readB.resolve("data:image/png;base64,b");
      await readB.promise;
    });
    expect(imageB.src).toBe("data:image/png;base64,b");

    act(() => imageB.emit("load"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("processed-b", "image/webp");

    act(() => {
      staleLoad(new Event("load"));
      staleError(new Event("error"));
    });
    await act(async () => {
      readA.resolve("data:image/png;base64,a");
      await readA.promise;
    });

    expect(imageA.src).toBe("");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("invalidates pending image callbacks when the cover is removed", async () => {
    mocks.blobToDataUrl.mockResolvedValue("data:image/png;base64,pending");
    const { input, onChange, getByRole } = renderCover(vi.fn(), "data:image/webp;base64,existing");

    fireEvent.change(input, {
      target: { files: [new File(["next"], "next.png", { type: "image/png" })] },
    });
    const pendingImage = ControlledImage.instances[0];
    await waitFor(() => expect(pendingImage.src).toBe("data:image/png;base64,pending"));
    const staleLoad = pendingImage.capture("load");
    const staleError = pendingImage.capture("error");

    fireEvent.click(getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null, null);

    act(() => {
      staleLoad(new Event("load"));
      staleError(new Event("error"));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("invalidates pending image callbacks on unmount", async () => {
    mocks.blobToDataUrl.mockResolvedValue("data:image/png;base64,pending");
    const { input, onChange, unmount } = renderCover();

    fireEvent.change(input, {
      target: { files: [new File(["next"], "next.png", { type: "image/png" })] },
    });
    const pendingImage = ControlledImage.instances[0];
    await waitFor(() => expect(pendingImage.src).toBe("data:image/png;base64,pending"));
    const staleLoad = pendingImage.capture("load");
    const staleError = pendingImage.capture("error");

    unmount();
    act(() => {
      staleLoad(new Event("load"));
      staleError(new Event("error"));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
