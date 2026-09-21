import { describe, expect, it } from "vitest";

import {
  chapterNumberSchema,
  createChapterSchema,
  createNovelSchema,
  editChapterSchema,
} from "@/lib/content/novel/novel.schemas";

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

  it("rejects a whitespace-only title while preserving the required-field message", () => {
    const result = createNovelSchema.safeParse({
      title: " \n\t ",
      sourceLang: "en",
      targetLang: "th",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ["title"],
        message: "Title is required",
      });
    }
  });
});

describe("chapterNumberSchema", () => {
  it.each([1.234, 1_000_000])("rejects %s because it cannot fit numeric(8,2)", (number) => {
    expect(chapterNumberSchema.safeParse(number).success).toBe(false);
  });

  it.each([1.25, 999_999.99])("accepts representable chapter number %s", (number) => {
    expect(chapterNumberSchema.safeParse(number).success).toBe(true);
  });
});

describe("createChapterSchema", () => {
  const validChapter = {
    novelId: "novel-1",
    number: 1,
    title: "Chapter 1",
    rawContent: "Chapter content",
  };

  it.each([
    ["title", " \t ", "Title is required"],
    ["rawContent", "\n ", "Content is required"],
  ])("rejects whitespace-only %s", (field, value, message) => {
    const result = createChapterSchema.safeParse({ ...validChapter, [field]: value });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({ path: [field], message });
    }
  });

  it.each([
    ["title", "Title is required"],
    ["rawContent", "Content is required"],
  ])("preserves the empty %s message", (field, message) => {
    const result = createChapterSchema.safeParse({ ...validChapter, [field]: "" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({ path: [field], message });
    }
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
