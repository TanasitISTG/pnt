import { describe, expect, it } from "vitest";

import { startTranslationJobSchema, startTranslationJobsSchema } from "./schemas";

describe("translation start schemas", () => {
  it("requires an explicit missing or overwrite mode", () => {
    expect(startTranslationJobSchema.safeParse({ chapterId: "chapter-1" }).success).toBe(false);
    expect(
      startTranslationJobSchema.safeParse({ chapterId: "chapter-1", mode: "missing" }).success,
    ).toBe(true);
    expect(
      startTranslationJobsSchema.safeParse({
        novelId: "novel-1",
        chapterIds: ["chapter-1"],
        mode: "overwrite",
      }).success,
    ).toBe(true);
  });
});
