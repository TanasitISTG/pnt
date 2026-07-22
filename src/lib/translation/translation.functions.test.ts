import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./translation.functions.ts", import.meta.url)),
  "utf8",
);

describe("translation batch query predicates", () => {
  it("does not interpolate arrays into raw ANY predicates", () => {
    expect(source).not.toContain("ANY(${");
  });
});
