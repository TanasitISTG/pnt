import { describe, it, expect } from "vitest";

import { extractIp, isOverLimit } from "@/lib/rate-limit";

describe("extractIp", () => {
  it("extracts the rightmost IP from x-forwarded-for header", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
    });
    expect(extractIp(headers)).toBe("150.172.238.178");
  });

  it("handles single IP in x-forwarded-for header", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.195",
    });
    expect(extractIp(headers)).toBe("203.0.113.195");
  });

  it("returns 'unknown' when x-forwarded-for header is absent", () => {
    const headers = new Headers();
    expect(extractIp(headers)).toBe("unknown");
  });
});

describe("isOverLimit", () => {
  it("returns true when count exceeds limit", () => {
    expect(isOverLimit(61, 60)).toBe(true);
    expect(isOverLimit(10, 5)).toBe(true);
  });

  it("returns false when count is within or equal to limit", () => {
    expect(isOverLimit(60, 60)).toBe(false);
    expect(isOverLimit(1, 60)).toBe(false);
  });
});
