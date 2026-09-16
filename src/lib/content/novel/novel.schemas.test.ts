import { describe, expect, it } from "vitest";

import { createNovelSchema, editChapterSchema } from "@/lib/content/novel/novel.schemas";

describe("createNovelSchema", () => {
  it("rejects an unsupported EN→EN language pair", () => {
    const result = createNovelSchema.safeParse({
      title: "Novel",
      sourceLang: "en",
      targetLang: "en",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["targetLang"]);
  });

  it.each([
    ["en", "th"],
    ["zh", "en"],
    ["zh", "th"],
  ])("accepts the supported %s→%s pair", (sourceLang, targetLang) => {
    const result = createNovelSchema.safeParse({ title: "Novel", sourceLang, targetLang });

    expect(result.success).toBe(true);
  });
});

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
