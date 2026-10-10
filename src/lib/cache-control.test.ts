import { describe, expect, it } from "vitest";

import { immutablePublicCacheControl, revalidatingPublicCacheControl } from "./cache-control";

describe("cache-control builders", () => {
  it("lets the CDN cache immutable public assets for a year", () => {
    expect(immutablePublicCacheControl()).toBe(
      "public, max-age=31536000, immutable, s-maxage=31536000",
    );
  });

  it("includes s-maxage so revalidating public responses are edge-cached", () => {
    expect(revalidatingPublicCacheControl(3600, 86400)).toBe(
      "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    );
  });
});
