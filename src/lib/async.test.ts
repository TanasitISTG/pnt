import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "@/lib/async";

describe("mapWithConcurrency", () => {
  it("caps active work and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([30, 5, 20, 10], 2, async (delay) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active--;
      return delay;
    });

    expect(maxActive).toBe(2);
    expect(results).toEqual([30, 5, 20, 10]);
  });

  it("uses one worker for invalid concurrency", async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency([1, 2, 3], Number.NaN, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
    });

    expect(maxActive).toBe(1);
  });
});
