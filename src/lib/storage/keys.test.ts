import { describe, expect, it } from "vitest";

import {
  AVATAR_KEY_ROOT,
  AVATAR_WIDTHS,
  avatarObjectKeyPrefix,
  avatarOriginalKey,
  avatarPrefix,
  avatarProxyPath,
  avatarVariantKey,
  COVER_WIDTHS,
  defaultAvatarWidth,
  parseAvatarPrefix,
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

  it("keeps avatars under a per-user prefix with an unguessable segment", () => {
    const prefix = avatarPrefix("user-1", "segment-1");
    expect(prefix).toBe("avatars/user-1/segment-1");
    expect(avatarOriginalKey(prefix)).toBe("avatars/user-1/segment-1/original");
    expect(avatarVariantKey(prefix, 128)).toBe("avatars/user-1/segment-1/128.webp");
    expect(defaultAvatarWidth()).toBe(AVATAR_WIDTHS[AVATAR_WIDTHS.length - 1]);
  });

  it("round-trips an avatar prefix and rejects any other shape", () => {
    expect(parseAvatarPrefix("avatars/user-1/segment-1")).toEqual({
      userId: "user-1",
      segment: "segment-1",
    });
    for (const value of [
      "",
      "avatars",
      "avatars/user-1",
      "avatars/user-1/segment-1/extra",
      "covers/user-1/segment-1",
      `${AVATAR_KEY_ROOT}//segment-1`,
    ]) {
      expect(parseAvatarPrefix(value)).toBeNull();
    }
  });

  it("groups avatar objects by the prefix a user row stores", () => {
    const prefix = avatarPrefix("user-1", "segment-1");

    for (const key of [avatarOriginalKey(prefix), avatarVariantKey(prefix, 64)]) {
      expect(avatarObjectKeyPrefix(key)).toBe(prefix);
    }
    // Anything deeper than `<prefix>/<file>` still belongs to that set, which is what a
    // prefix delete would remove anyway.
    expect(avatarObjectKeyPrefix(`${prefix}/extra/deeper`)).toBe(prefix);
    for (const key of [
      prefix,
      "avatars/user-1",
      "avatars",
      "",
      "covers/novel-1/segment-1/640.webp",
      "avatars-archive/user-1/segment-1/640.webp",
    ]) {
      expect(avatarObjectKeyPrefix(key)).toBeNull();
    }
  });

  it("addresses the fallback route by the same segment the key carries", () => {
    expect(avatarProxyPath("user-1", "segment-1", 64)).toBe("/api/avatars/user-1/segment-1?w=64");
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
