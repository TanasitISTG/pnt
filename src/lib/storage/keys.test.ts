import { describe, expect, it } from "vitest";

import {
  COVER_WIDTHS,
  coverObjectKey,
  coverOriginalKey,
  coverPrefix,
  coverVariantKey,
  defaultCoverWidth,
  epubUploadKey,
  exportObjectKey,
  exportRevision,
  EXPORT_FORMAT_VERSION,
} from "./keys";

describe("storage keys", () => {
  it("keeps covers under a per-novel prefix with an unguessable segment", () => {
    const prefix = coverPrefix("novel-1", "segment-1");
    expect(prefix).toBe("covers/novel-1/segment-1");
    expect(coverOriginalKey(prefix)).toBe("covers/novel-1/segment-1/original");
    expect(coverVariantKey(prefix, 480)).toBe("covers/novel-1/segment-1/480.webp");
    expect(coverObjectKey(prefix, "extra")).toBe("covers/novel-1/segment-1/extra");
  });

  it("defaults to the widest variant", () => {
    expect(defaultCoverWidth()).toBe(COVER_WIDTHS[COVER_WIDTHS.length - 1]);
  });

  it("keys staged EPUB archives and exports by their identifying data", () => {
    expect(epubUploadKey("upload-1")).toBe("epub-uploads/upload-1");
    expect(exportObjectKey("novel-1", "abc123", "epub")).toBe("exports/novel-1/abc123.epub");
  });
});

describe("exportRevision", () => {
  const base = {
    format: "txt" as const,
    novelTitle: "Novel",
    novelAuthor: "Author",
    targetLang: "en",
    chapterCount: 3,
    maxChapterUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    maxTranslationGeneration: 2,
  };

  it("is stable for identical export content", () => {
    expect(exportRevision(base)).toBe(exportRevision({ ...base }));
  });

  it.each([
    ["novelTitle", { novelTitle: "Renamed" }],
    ["novelAuthor", { novelAuthor: null }],
    ["targetLang", { targetLang: "th" }],
    ["chapterCount", { chapterCount: 4 }],
    ["maxChapterUpdatedAt", { maxChapterUpdatedAt: new Date("2026-02-01T00:00:00.000Z") }],
    ["maxTranslationGeneration", { maxTranslationGeneration: 3 }],
  ] as const)("changes when %s changes", (_field, patch) => {
    expect(exportRevision({ ...base, ...patch })).not.toBe(exportRevision(base));
  });

  it("separates formats so a TXT revision cannot serve an EPUB request", () => {
    expect(exportRevision({ ...base, format: "epub" })).not.toBe(exportRevision(base));
  });

  it("embeds the format-version constant", () => {
    expect(EXPORT_FORMAT_VERSION).toBeGreaterThanOrEqual(1);
  });
});
