import { describe, expect, it } from "vitest";

import { residualRevisionOf } from "./residual-revision";

describe("residualRevisionOf", () => {
  it("counts only translated chapters and takes the latest update", () => {
    expect(
      residualRevisionOf(
        [
          { status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" },
          { status: "raw", updatedAt: "2026-01-02T00:00:00.000Z" },
          { status: "translated", updatedAt: "2026-01-03T00:00:00.000Z" },
        ],
        4,
      ),
    ).toBe("2:2026-01-03T00:00:00.000Z:4");
  });

  it("changes when a translated chapter body changes", () => {
    const before = residualRevisionOf(
      [{ status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" }],
      0,
    );
    const after = residualRevisionOf(
      [{ status: "translated", updatedAt: "2026-01-02T00:00:00.000Z" }],
      0,
    );
    expect(after).not.toBe(before);
  });

  it("changes when the approved glossary set changes", () => {
    const chapters = [{ status: "translated", updatedAt: "2026-01-01T00:00:00.000Z" }];
    expect(residualRevisionOf(chapters, 1)).not.toBe(residualRevisionOf(chapters, 2));
  });

  it("accepts Date values and an empty chapter list", () => {
    expect(
      residualRevisionOf(
        [{ status: "translated", updatedAt: new Date("2026-01-01T00:00:00.000Z") }],
        0,
      ),
    ).toBe("1:2026-01-01T00:00:00.000Z:0");
    expect(residualRevisionOf([], 0)).toBe("0::0");
  });
});
