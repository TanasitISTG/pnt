import { describe, expect, it } from "vitest";

import { formatLocalTime, parseDateTime } from "./date-time";

describe("date-time helpers", () => {
  it("rejects legacy wall-clock strings without timezone context", () => {
    expect(parseDateTime("22:09:36")).toBeNull();
    expect(formatLocalTime("22:09:36")).toBe("—");
  });

  it("formats an ISO timestamp in the runtime locale", () => {
    const formatted = formatLocalTime("2026-08-02T12:34:56.000Z");

    expect(formatted).not.toBe("—");
    expect(formatted).toMatch(/\d{1,2}:34:56/);
  });
});
