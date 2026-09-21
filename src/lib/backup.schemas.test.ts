import { describe, expect, it } from "vitest";

import { assertExportableBackup, parseBackup } from "./backup.schemas";
import { SafeServerError } from "./server-fn-error";

const exportedAt = "2026-01-01T00:00:00.000Z";

function chapter(overrides: Record<string, unknown> = {}) {
  return {
    id: "chapter-1",
    number: "1.00",
    title: "Chapter 1",
    translatedTitle: null,
    rawContent: "Raw content",
    translatedContent: null,
    status: "raw",
    summary: null,
    rawCharCount: 11,
    sourceRevision: 1,
    translationGeneration: 1,
    publishedAt: null,
    translatedAt: null,
    editedAt: null,
    createdAt: exportedAt,
    updatedAt: exportedAt,
    ...overrides,
  };
}

function novel(overrides: Record<string, unknown> = {}) {
  return {
    id: "novel-1",
    title: "Novel",
    originalTitle: null,
    author: null,
    description: null,
    coverBase64: null,
    coverMime: null,
    sourceLang: "zh",
    targetLang: "en",
    customPrompt: null,
    storySummary: null,
    chunkSize: 4000,
    contextTailLength: 500,
    publishedAt: null,
    createdAt: exportedAt,
    updatedAt: exportedAt,
    chapters: [chapter()],
    glossaryTerms: [],
    ...overrides,
  };
}

function backup(novelOverrides: Record<string, unknown> = {}) {
  return {
    app: "pnt",
    schemaVersion: 1,
    exportedAt,
    novels: [novel(novelOverrides)],
  };
}

describe("backup restore schema", () => {
  it("accepts a backup the exporter produces", () => {
    const parsed = parseBackup(backup());

    expect(parsed.novels[0]?.contextTailLength).toBe(500);
    expect(parsed.novels[0]?.chapters[0]?.number).toBe("1.00");
  });

  it.each([
    ["originalTitle", 500],
    ["author", 200],
    ["description", 5000],
    ["customPrompt", 10000],
  ] as const)("preserves the required nullable %s field and its live limit", (field, limit) => {
    const exact = backup({ [field]: "x".repeat(limit) });
    expect(parseBackup(exact).novels[0]?.[field]).toBe("x".repeat(limit));
    expect(assertExportableBackup(exact).novels[0]?.[field]).toBe("x".repeat(limit));
    expect(parseBackup(backup({ [field]: null })).novels[0]?.[field]).toBeNull();
    expect(() => parseBackup(backup({ [field]: undefined }))).toThrow(SafeServerError);
    expect(() => parseBackup(backup({ [field]: "x".repeat(limit + 1) }))).toThrow(SafeServerError);
    expect(() => assertExportableBackup(backup({ [field]: "x".repeat(limit + 1) }))).toThrow(
      SafeServerError,
    );
  });

  it("rejects tail lengths the SQL slice cannot express", () => {
    expect(() => parseBackup(backup({ contextTailLength: -20 }))).toThrow(/contextTailLength/);
    expect(() => parseBackup(backup({ contextTailLength: 0 }))).toThrow(/contextTailLength/);
    expect(() => parseBackup(backup({ contextTailLength: 500.5 }))).toThrow(/contextTailLength/);
    expect(() => parseBackup(backup({ contextTailLength: 50 }))).toThrow(/contextTailLength/);
  });

  it("rejects chunk sizes that would explode the step count", () => {
    expect(() => parseBackup(backup({ chunkSize: 1 }))).toThrow(/chunkSize/);
    expect(() => parseBackup(backup({ chunkSize: 4000.5 }))).toThrow(/chunkSize/);
    expect(() => parseBackup(backup({ chunkSize: 100_000 }))).toThrow(/chunkSize/);
  });

  it("rejects chapter numbers the numeric column cannot store", () => {
    expect(() => parseBackup(backup({ chapters: [chapter({ number: "0" })] }))).toThrow(
      /chapters\.0\.number/,
    );
    expect(() => parseBackup(backup({ chapters: [chapter({ number: "-1" })] }))).toThrow(
      /chapters\.0\.number/,
    );
    expect(() => parseBackup(backup({ chapters: [chapter({ number: "1.234" })] }))).toThrow(
      /chapters\.0\.number/,
    );
    expect(() => parseBackup(backup({ chapters: [chapter({ number: "1234567" })] }))).toThrow(
      /chapters\.0\.number/,
    );
  });

  it("rejects counters the integer columns cannot store", () => {
    expect(() => parseBackup(backup({ chapters: [chapter({ sourceRevision: -1 })] }))).toThrow(
      /sourceRevision/,
    );
    expect(() =>
      parseBackup(backup({ chapters: [chapter({ translationGeneration: 1.5 })] })),
    ).toThrow(/translationGeneration/);
    expect(() => parseBackup(backup({ chapters: [chapter({ rawCharCount: -5 })] }))).toThrow(
      /rawCharCount/,
    );
  });

  it.each([
    [
      "blank translated content",
      { translatedContent: "   ", status: "queued" },
      /translatedContent/,
    ],
    ["translated status without content", { status: "translated" }, /status/],
    [
      "raw status with translated content",
      { status: "raw", translatedContent: "Translated content" },
      /status/,
    ],
  ])("rejects %s", (_name, overrides, expectedField) => {
    expect(() => parseBackup(backup({ chapters: [chapter(overrides)] }))).toThrow(expectedField);
  });

  it("requires rawCharCount to equal JavaScript rawContent.length", () => {
    const rawContent = "A🙂";

    expect(
      parseBackup(backup({ chapters: [chapter({ rawContent, rawCharCount: rawContent.length })] }))
        .novels[0]?.chapters[0]?.rawCharCount,
    ).toBe(3);
    expect(() =>
      parseBackup(backup({ chapters: [chapter({ rawContent, rawCharCount: 2 })] })),
    ).toThrow(/rawCharCount/);
  });

  it("rejects dates the restore would parse into an invalid timestamp", () => {
    expect(() =>
      parseBackup(backup({ chapters: [chapter({ translatedAt: "yesterday" })] })),
    ).toThrow(/translatedAt/);
    expect(() => parseBackup(backup({ chapters: [chapter({ editedAt: "not-a-date" })] }))).toThrow(
      /editedAt/,
    );
  });

  it("keeps restored covers to real image media types", () => {
    expect(() => parseBackup(backup({ coverMime: "text/html" }))).toThrow(/coverMime/);
    expect(() => parseBackup(backup({ coverBase64: "AAAA", coverMime: null }))).toThrow(
      /coverMime/,
    );
    expect(() =>
      parseBackup(backup({ coverBase64: "A".repeat(1_400_001), coverMime: "image/png" })),
    ).toThrow(/coverBase64/);
    expect(() =>
      parseBackup(backup({ coverBase64: "AAAA", coverMime: "image/png" })),
    ).not.toThrow();
  });

  it("rejects duplicates the unique indexes would reject after the transaction opens", () => {
    expect(() =>
      parseBackup(backup({ chapters: [chapter(), chapter({ id: "chapter-2", number: "1" })] })),
    ).toThrow(/duplicate chapter numbers/);

    const term = {
      id: "term-1",
      source: "许野",
      target: "สวี่เหยี่ย",
      category: "character",
      note: null,
      status: "approved",
      createdAt: exportedAt,
      updatedAt: exportedAt,
    };
    expect(() => parseBackup(backup({ glossaryTerms: [term, { ...term, id: "term-2" }] }))).toThrow(
      /duplicate glossary sources/,
    );
  });

  it("still rejects unsupported language pairs", () => {
    expect(() => parseBackup(backup({ sourceLang: "en", targetLang: "en" }))).toThrow(
      /unsupported language pair/i,
    );
  });

  it("names the direction when export-side data cannot round-trip", () => {
    expect(() =>
      assertExportableBackup({ app: "pnt", schemaVersion: 1, exportedAt, novels: [] }),
    ).not.toThrow();
    expect(() => assertExportableBackup(backup({ chunkSize: 10 }))).toThrow(
      /Backup export failed validation/,
    );
    expect(() => parseBackup(backup({ chunkSize: 10 }))).toThrow(/Invalid backup file/);
  });

  it("reports the first issue instead of a generic failure", () => {
    let thrown: unknown;
    try {
      parseBackup(backup({ contextTailLength: -20 }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SafeServerError);
    expect((thrown as Error).message).toContain("Invalid backup file");
    expect((thrown as Error).message).toContain("novels.0.contextTailLength");
  });
});
