import { beforeEach, describe, expect, it, vi } from "vitest";

const { setResponseHeader } = vi.hoisted(() => ({
  setResponseHeader: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({ setResponseHeader }));

import { createServerTiming } from "@/lib/server-timing";

describe("createServerTiming", () => {
  beforeEach(() => {
    setResponseHeader.mockReset();
  });

  it("records successful and rejected measurements", async () => {
    let time = 100;
    const timing = createServerTiming(() => time);

    await expect(
      timing.measure("auth", async () => {
        time = 112.34;
        return "ok";
      }),
    ).resolves.toBe("ok");
    await expect(
      timing.measure("novels", async () => {
        time = 120.01;
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");

    time = 121.26;
    timing.flush();

    expect(setResponseHeader).toHaveBeenCalledOnce();
    expect(setResponseHeader).toHaveBeenCalledWith(
      "Server-Timing",
      "auth;dur=12.3, novels;dur=7.7, total;dur=21.3",
    );
  });

  it("emits concurrent measurements before flushing", async () => {
    let time = 0;
    const timing = createServerTiming(() => time);

    await Promise.all([
      timing.measure("translation-jobs", async () => {
        await Promise.resolve();
        time = 3;
      }),
      timing.measure("import-jobs", async () => {
        await Promise.resolve();
        time = 6;
      }),
    ]);

    timing.flush();

    expect(setResponseHeader).toHaveBeenCalledWith(
      "Server-Timing",
      expect.stringMatching(
        /^translation-jobs;dur=\d+\.\d, import-jobs;dur=\d+\.\d, total;dur=6\.0$/,
      ),
    );
  });

  it("measures total from recorder creation through flush", () => {
    let time = 100;
    const timing = createServerTiming(() => time);

    time = 105;
    timing.flush();

    expect(setResponseHeader).toHaveBeenCalledWith("Server-Timing", "total;dur=5.0");
  });

  it("does not write or replace the header after the first flush", () => {
    let time = 10;
    const timing = createServerTiming(() => time);

    time = 12;
    timing.flush();
    const firstHeader = setResponseHeader.mock.calls[0]?.[1];

    time = 50;
    timing.flush();

    expect(setResponseHeader).toHaveBeenCalledOnce();
    expect(setResponseHeader.mock.calls[0]?.[1]).toBe(firstHeader);
  });
});
