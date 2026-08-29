import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { batchesOf } from "@/lib/content/chapter-ops.service";

const source = readFileSync(
  fileURLToPath(new URL("./chapter-ops.functions.ts", import.meta.url)),
  "utf8",
);

describe("batchesOf", () => {
  it("splits into consecutive fixed-size batches preserving order", () => {
    const items = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(batchesOf(items, 5)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12],
    ]);
  });

  it("returns a single batch when items fit", () => {
    expect(batchesOf([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("returns no batches for empty input", () => {
    expect(batchesOf([], 5)).toEqual([]);
  });

  it("keeps exact multiples in equal batches", () => {
    expect(batchesOf([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("getResidualHanziChapters", () => {
  it("pre-filters in SQL with the shared CJK class instead of loading all chapter bodies", () => {
    expect(source).toContain("RESIDUAL_CJK_SQL_RE");
    expect(source).toContain("~ ${RESIDUAL_CJK_SQL_RE}");
  });

  it("fetches translatedContent only for flagged chapter ids", () => {
    expect(source).toContain("inArray(");
    expect(source).toContain("flagged.map((c) => c.id)");
  });
});
