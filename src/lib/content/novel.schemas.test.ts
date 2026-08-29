import { describe, expect, it } from "vitest";

import { editChapterSchema } from "@/lib/content/novel.schemas";

describe("editChapterSchema", () => {
  it.each([
    { field: "title", input: { title: "   " } },
    { field: "rawContent", input: { rawContent: "\n\t" } },
    { field: "translatedContent", input: { translatedContent: "   " } },
  ])("rejects whitespace-only $field", ({ field, input }) => {
    const result = editChapterSchema.safeParse({ chapterId: "chapter-1", ...input });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([field]);
  });

  it("allows clearing translated fields", () => {
    expect(
      editChapterSchema.safeParse({
        chapterId: "chapter-1",
        translatedTitle: "",
        translatedContent: null,
        sourceChangePolicy: "clear",
      }).success,
    ).toBe(true);
  });
});
