import { describe, expect, it } from "vitest";

import {
  chapterBodyV1Schema,
  chapterManifestV1Schema,
  chapterSummaryV1Schema,
  novelDetailV1Schema,
  novelListV1Schema,
} from "@pnt/contracts/content";

const updatedAt = "2026-01-02T03:04:05.000Z";
const metadata = {
  id: "novel-1",
  title: "A novel",
  originalTitle: null,
  author: null,
  description: null,
  sourceLang: "zh",
  targetLang: "th",
  publishedAt: null,
  createdAt: updatedAt,
  updatedAt,
  hasCover: false,
};

const chapter = {
  id: "chapter-1",
  novelId: metadata.id,
  number: "1.50",
  title: "A chapter",
  translatedTitle: null,
  status: "translated" as const,
  updatedAt,
};

describe("v1 public content DTOs", () => {
  it("requires projected novel metadata instead of accepting database rows or owner settings", () => {
    const list = { ...metadata, chapterCount: 2, translatedCount: 1 };
    expect(novelListV1Schema.parse(list)).toEqual(list);
    expect(novelDetailV1Schema.parse(metadata)).toEqual(metadata);

    expect(novelListV1Schema.safeParse({ ...list, hasCover: 1 }).success).toBe(false);
    expect(novelListV1Schema.safeParse({ ...list, createdAt: new Date(updatedAt) }).success).toBe(
      false,
    );
    expect(novelDetailV1Schema.safeParse({ ...metadata, customPrompt: "private" }).success).toBe(
      false,
    );
    expect(novelDetailV1Schema.safeParse({ ...metadata, description: undefined }).success).toBe(
      false,
    );
  });

  it("keeps chapter numbers as decimal text and rejects unprojected body fields", () => {
    const summary = { ...chapter, hasTranslation: true, publishedAt: null };
    const manifest = {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      translatedTitle: chapter.translatedTitle,
    };
    const body = { ...chapter, rawContent: "Original", translatedContent: null };
    expect(chapterSummaryV1Schema.parse(summary)).toEqual(summary);
    expect(chapterManifestV1Schema.parse([manifest])).toEqual([manifest]);
    expect(chapterBodyV1Schema.parse(body)).toEqual(body);

    expect(chapterSummaryV1Schema.safeParse({ ...summary, number: 1.5 }).success).toBe(false);
    expect(
      chapterManifestV1Schema.safeParse([{ ...manifest, rawContent: "private" }]).success,
    ).toBe(false);
    expect(chapterBodyV1Schema.safeParse({ ...body, summary: "private" }).success).toBe(false);
    expect(chapterBodyV1Schema.safeParse({ ...body, updatedAt: new Date(updatedAt) }).success).toBe(
      false,
    );
  });
});
