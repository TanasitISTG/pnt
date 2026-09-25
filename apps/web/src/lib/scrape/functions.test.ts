import { describe, expect, it } from "vitest";

import { startImportJobSchema } from "./functions";

const baseInput = {
  novelId: "novel-1",
  baseUrl: "https://www.quanben.io/n/example/1.html",
  provider: "auto" as const,
};

describe("startImportJobSchema", () => {
  it("accepts an inclusive 500-chapter range", () => {
    expect(startImportJobSchema.safeParse({ ...baseInput, from: 1, to: 500 }).success).toBe(true);
    expect(
      startImportJobSchema.safeParse({ ...baseInput, from: 999_500, to: 999_999 }).success,
    ).toBe(true);
  });

  it("rejects a 501-chapter range and numbers above the chapter ceiling", () => {
    expect(startImportJobSchema.safeParse({ ...baseInput, from: 1, to: 501 }).success).toBe(false);
    expect(
      startImportJobSchema.safeParse({ ...baseInput, from: 1_000_000, to: 1_000_000 }).success,
    ).toBe(false);
  });

  it.each([
    "https://www.quanben.io/n/example/",
    "https://alice:secret@www.quanben.io/n/example/1.html",
    "https://unsupported.example/1.html",
  ])("rejects an invalid source URL before job creation: %s", (baseUrl) => {
    const result = startImportJobSchema.safeParse({ ...baseInput, baseUrl, from: 1, to: 2 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["baseUrl"]);
  });
});
