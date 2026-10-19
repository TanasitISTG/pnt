import { describe, expect, it } from "vitest";

import {
  audienceBucketCount,
  audienceRangeDays,
  audienceWindowStart,
  DEFAULT_AUDIENCE_RANGE,
  fillDailyBuckets,
  percentShare,
} from "./aggregate";

describe("audience aggregation", () => {
  const now = new Date("2026-10-17T09:30:00.000Z");

  it("maps each fixed range to its days and all time to no boundary", () => {
    expect(audienceRangeDays("7d")).toBe(7);
    expect(audienceRangeDays("30d")).toBe(30);
    expect(audienceRangeDays("90d")).toBe(90);
    expect(audienceRangeDays("all")).toBeNull();
    // The report opens on the month, which is the window nobody has to choose first.
    expect(DEFAULT_AUDIENCE_RANGE).toBe("30d");
  });

  it("starts a window at UTC midnight of its earliest day, today included", () => {
    expect(audienceWindowStart("7d", now)?.toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(audienceWindowStart("30d", now)?.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(audienceWindowStart("90d", now)?.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(audienceWindowStart("all", now)).toBeNull();
  });

  it("draws a fixed range's own days and a lifetime from its first read", () => {
    expect(audienceBucketCount("7d", [], now)).toBe(7);
    expect(audienceBucketCount("90d", [], now)).toBe(90);
    expect(audienceBucketCount("all", [{ day: "2026-10-10", reads: 2 }], now)).toBe(8);
    // The earliest row decides the start, not the order the rows arrive in.
    expect(
      audienceBucketCount(
        "all",
        [
          { day: "2026-10-10", reads: 2 },
          { day: "2026-09-01", reads: 1 },
        ],
        now,
      ),
    ).toBe(47);
    // A lifetime with nothing in it keeps the month's shape rather than a single bar.
    expect(audienceBucketCount("all", [], now)).toBe(30);
  });

  it("fills a seven-day window oldest first", () => {
    const buckets = fillDailyBuckets([{ day: "2026-10-17", reads: 3 }], now, 7);
    expect(buckets).toHaveLength(7);
    expect(buckets[0].day).toBe("2026-10-11");
    expect(buckets.at(-1)).toEqual({ day: "2026-10-17", reads: 3 });
  });

  it("returns the window oldest first, filling quiet days with zero", () => {
    const buckets = fillDailyBuckets(
      [
        { day: "2026-10-17", reads: 4 },
        { day: "2026-10-15", reads: 2 },
      ],
      now,
    );
    expect(buckets).toHaveLength(30);
    expect(buckets[0].day).toBe("2026-09-18");
    expect(buckets[29]).toEqual({ day: "2026-10-17", reads: 4 });
    expect(buckets.find((bucket) => bucket.day === "2026-10-15")?.reads).toBe(2);
    expect(buckets.find((bucket) => bucket.day === "2026-10-16")?.reads).toBe(0);
  });

  it("ignores a row outside the window rather than stretching it", () => {
    const buckets = fillDailyBuckets([{ day: "2026-01-01", reads: 9 }], now);
    expect(buckets).toHaveLength(30);
    expect(buckets.some((bucket) => bucket.reads === 9)).toBe(false);
  });

  it("reports a share as a whole number, zero when nobody read", () => {
    expect(percentShare(1, 4)).toBe(25);
    expect(percentShare(3, 3)).toBe(100);
    expect(percentShare(0, 0)).toBe(0);
    expect(percentShare(5, 0)).toBe(0);
  });
});
