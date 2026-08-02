import { describe, expect, it } from "vitest";

import { publishState } from "./publish";

describe("publishState", () => {
  const now = new Date("2026-07-20T12:00:00Z");

  it("returns draft when publishedAt is null/undefined", () => {
    expect(publishState(null, now)).toBe("draft");
    expect(publishState(undefined, now)).toBe("draft");
  });

  it("returns live when publishedAt is in the past or now", () => {
    expect(publishState(new Date("2026-07-20T11:59:59Z"), now)).toBe("live");
    expect(publishState(now, now)).toBe("live");
    expect(publishState("2026-01-01T00:00:00Z", now)).toBe("live");
  });

  it("returns scheduled when publishedAt is in the future", () => {
    expect(publishState(new Date("2026-07-20T12:00:01Z"), now)).toBe("scheduled");
    expect(publishState("2027-01-01T00:00:00Z", now)).toBe("scheduled");
  });
});
