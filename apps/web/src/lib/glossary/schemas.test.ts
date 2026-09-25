import { describe, expect, it } from "vitest";
import { createTermSchema, previewTermReplacementSchema, updateTermSchema } from "./schemas";

describe("glossary term text validation", () => {
  it("rejects whitespace-only create and update fields and preview needles", () => {
    const blank = " \t\n ";
    expect(
      createTermSchema.safeParse({ novelId: "novel", source: blank, target: "Beta" }).success,
    ).toBe(false);
    expect(
      createTermSchema.safeParse({ novelId: "novel", source: "Alpha", target: blank }).success,
    ).toBe(false);
    expect(updateTermSchema.safeParse({ termId: "term", source: blank }).success).toBe(false);
    expect(updateTermSchema.safeParse({ termId: "term", target: blank }).success).toBe(false);
    expect(
      previewTermReplacementSchema.safeParse({ novelId: "novel", oldTarget: blank }).success,
    ).toBe(false);
  });

  it("normalizes padded text while retaining optional update fields", () => {
    expect(
      createTermSchema.parse({ novelId: "novel", source: " Alpha ", target: " Beta " }),
    ).toMatchObject({ source: "Alpha", target: "Beta" });
    expect(updateTermSchema.parse({ termId: "term", source: " Alpha ", target: " Beta " })).toEqual(
      { termId: "term", source: "Alpha", target: "Beta" },
    );
    expect(updateTermSchema.parse({ termId: "term", note: "note" })).toEqual({
      termId: "term",
      note: "note",
    });
    expect(previewTermReplacementSchema.parse({ novelId: "novel", oldTarget: " Beta " })).toEqual({
      novelId: "novel",
      oldTarget: "Beta",
    });
  });
});
