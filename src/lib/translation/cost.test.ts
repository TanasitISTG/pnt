import { describe, expect, it } from "vitest";

import { calculateTokenCost } from "./cost";

describe("calculateTokenCost", () => {
  it("uses the prices captured for the completed job", () => {
    expect(calculateTokenCost(1_000, 500, 2, 10)).toBe(0.007);
    expect(calculateTokenCost(1_000, 500, 20, 100)).toBe(0.07);
  });

  it("returns no cost when token usage or pricing is invalid", () => {
    expect(calculateTokenCost(-1, 10, 2, 10)).toBeNull();
    expect(calculateTokenCost(1, 10, null, 10)).toBeNull();
  });
});
