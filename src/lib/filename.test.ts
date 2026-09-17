import { describe, expect, it } from "vitest";

import { contentDisposition, sanitizeFilename } from "@/lib/filename";

function extendedFilename(header: string): string {
  const match = /filename\*=UTF-8''(.+)$/.exec(header);
  if (!match) throw new Error(`No extended filename in ${header}`);
  return match[1];
}

describe("sanitizeFilename", () => {
  it("removes forbidden characters, controls, and leading dots", () => {
    expect(sanitizeFilename("O'Brien (1)*.epub")).toBe("O'Brien (1).epub");
    expect(sanitizeFilename('\u0000\u001f\u007f a/b\\c:d?e"f<g>h|i ')).toBe("abcdefghi");
    expect(sanitizeFilename("...hidden.txt")).toBe("hidden.txt");
  });

  it("preserves internal dots and meaningful Unicode", () => {
    expect(sanitizeFilename("my.file.name.txt")).toBe("my.file.name.txt");
    expect(sanitizeFilename("เรื่องเล่า บทที่ 1")).toBe("เรื่องเล่า บทที่ 1");
  });

  it("falls back to export for empty or dot-only input", () => {
    expect(sanitizeFilename("   ")).toBe("export");
    expect(sanitizeFilename("...")).toBe("export");
  });
});

describe("contentDisposition", () => {
  it("escapes quote, parentheses, and star in the extended filename", () => {
    const header = contentDisposition("O'Brien (1)*.epub");
    expect(header).toContain('filename="O\'Brien (1).epub"');
    const extended = extendedFilename(header);
    expect(extended).not.toMatch(/['()*]/);
    expect(extended).toContain("%27");
    expect(extended).toContain("%28");
    expect(extended).toContain("%29");
    expect(decodeURIComponent(extended)).toBe("O'Brien (1).epub");
  });

  it("keeps the quoted fallback ASCII-only for Unicode titles", () => {
    const header = contentDisposition("เรื่องเล่า บทที่ 1.txt");
    const quoted = /filename="([^"]*)"/.exec(header)?.[1];
    expect(quoted).toBeDefined();
    expect(quoted).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(extendedFilename(header))).toBe("เรื่องเล่า บทที่ 1.txt");
  });

  it("strips controls and path separators from both variants", () => {
    const header = contentDisposition("a\r\nb/c\\d\u007f.txt");
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="abcd.txt"');
    expect(decodeURIComponent(extendedFilename(header))).toBe("abcd.txt");
  });

  it("preserves multi-dot names and falls back for dot-only input", () => {
    const header = contentDisposition("archive.tar.gz");
    expect(header).toContain('filename="archive.tar.gz"');
    expect(header).toContain("filename*=UTF-8''archive.tar.gz");

    const fallback = contentDisposition("...");
    expect(fallback).toContain('filename="export"');
    expect(fallback).toContain("filename*=UTF-8''export");
  });
});
