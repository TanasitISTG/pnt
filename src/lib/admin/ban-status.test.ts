import { describe, expect, it } from "vitest";

import { describeBan } from "./ban-status";

const NOW = new Date("2026-10-12T12:00:00.000Z");

describe("describeBan", () => {
  it("reads a row with no ban as active", () => {
    expect(describeBan({ banned: false, banExpires: null }, NOW)).toEqual({
      state: "active",
      expiresAt: null,
    });
  });

  it("ignores a stale expiry on an unbanned row", () => {
    expect(
      describeBan({ banned: false, banExpires: new Date("2020-01-01T00:00:00.000Z") }, NOW).state,
    ).toBe("active");
  });

  it("reports a suspension whose expiry is still ahead", () => {
    const expiresAt = new Date("2026-10-19T12:00:00.000Z");
    expect(describeBan({ banned: true, banExpires: expiresAt }, NOW)).toEqual({
      state: "suspended",
      expiresAt,
    });
  });

  it("reports a lapsed suspension as expired rather than suspended", () => {
    // The plugin leaves `banned` set until the account next signs in, so the row is
    // the only evidence that the expiry has already passed.
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");
    expect(describeBan({ banned: true, banExpires: expiresAt }, NOW)).toEqual({
      state: "expired",
      expiresAt,
    });
  });

  it("treats the exact expiry instant as lapsed", () => {
    expect(describeBan({ banned: true, banExpires: NOW }, NOW).state).toBe("expired");
  });

  it("reports a permanent suspension with no expiry", () => {
    expect(describeBan({ banned: true, banExpires: null }, NOW)).toEqual({
      state: "suspended",
      expiresAt: null,
    });
  });
});
