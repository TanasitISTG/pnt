import { describe, expect, it } from "vitest";

import { formatAbsoluteTime, formatRelativeTime } from "./relative-time";

const NOW = new Date("2026-02-01T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

describe("formatRelativeTime", () => {
  it("reads a fresh comment as just now", () => {
    expect(formatRelativeTime(ago(5), NOW)).toBe("just now");
  });

  it("counts minutes, hours, and days", () => {
    expect(formatRelativeTime(ago(5 * 60), NOW)).toBe("5m ago");
    expect(formatRelativeTime(ago(3 * 60 * 60), NOW)).toBe("3h ago");
    expect(formatRelativeTime(ago(3 * 24 * 60 * 60), NOW)).toBe("3d ago");
  });

  it("switches to months and then to a date, so nothing reads as 400d ago", () => {
    expect(formatRelativeTime(ago(60 * 24 * 60 * 60), NOW)).toBe("2mo ago");
    expect(formatRelativeTime(ago(400 * 24 * 60 * 60), NOW)).toBe(
      ago(400 * 24 * 60 * 60).toLocaleDateString(),
    );
  });

  it("accepts a serialized timestamp, which is what RPC delivers", () => {
    expect(formatRelativeTime(ago(120).toISOString(), NOW)).toBe("2m ago");
  });
});

describe("formatAbsoluteTime", () => {
  it("formats the exact moment for a title attribute", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(formatAbsoluteTime(date)).toBe(date.toLocaleString());
  });
});
