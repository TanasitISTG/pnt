import { describe, expect, it } from "vitest";

import { diffChapterTranslations, diffParagraphs } from "./translation-diff";

describe("translation diff", () => {
  it("reports an unchanged chapter as all same", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const result = diffChapterTranslations(text, text);
    expect(result).toEqual({
      lines: [
        { kind: "same", text: "First paragraph." },
        { kind: "same", text: "Second paragraph." },
        { kind: "same", text: "Third paragraph." },
      ],
      added: 0,
      removed: 0,
      unchanged: 3,
    });
  });

  it("marks a single changed paragraph as one removal and one addition", () => {
    const result = diffChapterTranslations(
      "First.\n\nOld name appears here.\n\nLast.",
      "First.\n\nNew name appears here.\n\nLast.",
    );
    expect(result.lines).toEqual([
      { kind: "same", text: "First." },
      { kind: "removed", text: "Old name appears here." },
      { kind: "added", text: "New name appears here." },
      { kind: "same", text: "Last." },
    ]);
    expect(result).toMatchObject({ added: 1, removed: 1, unchanged: 2 });
  });

  it("distinguishes an insertion from a replacement", () => {
    const result = diffChapterTranslations("One.\n\nTwo.", "One.\n\nOne and a half.\n\nTwo.");
    expect(result.lines).toEqual([
      { kind: "same", text: "One." },
      { kind: "added", text: "One and a half." },
      { kind: "same", text: "Two." },
    ]);
    expect(result).toMatchObject({ added: 1, removed: 0, unchanged: 2 });
  });

  it("shows a moved paragraph as removed then added, not as unchanged", () => {
    const result = diffChapterTranslations("A.\n\nB.\n\nC.", "B.\n\nA.\n\nC.");
    expect(result.lines.filter((line) => line.kind === "same").map((line) => line.text)).toEqual([
      "B.",
      "C.",
    ]);
    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
  });

  it("keeps a one-sided text intact", () => {
    expect(diffChapterTranslations("", "Only new.").lines).toEqual([
      { kind: "added", text: "Only new." },
    ]);
    expect(diffChapterTranslations("Only old.", "").lines).toEqual([
      { kind: "removed", text: "Only old." },
    ]);
    expect(diffChapterTranslations("", "")).toEqual({
      lines: [],
      added: 0,
      removed: 0,
      unchanged: 0,
    });
  });

  it("attributes one renamed term to exactly the paragraphs that carried it", () => {
    const before = Array.from({ length: 40 }, (_, index) =>
      index % 4 === 0 ? `Chapter ${index}: the old name speaks.` : `Narration ${index}.`,
    );
    const after = before.map((text) => text.replaceAll("old name", "new name"));
    const result = diffChapterTranslations(before.join("\n\n"), after.join("\n\n"));
    expect(result.removed).toBe(10);
    expect(result.added).toBe(10);
    expect(result.unchanged).toBe(30);
  });

  it("stays fast on a full-length chapter", () => {
    const before = Array.from({ length: 2_000 }, (_, index) => `Paragraph ${index}.`);
    const after = [...before];
    after[1_000] = "Paragraph 1000, revised.";
    const started = performance.now();
    const result = diffChapterTranslations(before.join("\n\n"), after.join("\n\n"));
    const elapsed = performance.now() - started;
    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    expect(elapsed).toBeLessThan(500);
  });

  it("falls back to a block diff when no paragraph is unique", () => {
    const lines = diffParagraphs(["x", "x"], ["y", "y"]);
    expect(lines).toEqual([
      { kind: "removed", text: "x" },
      { kind: "removed", text: "x" },
      { kind: "added", text: "y" },
      { kind: "added", text: "y" },
    ]);
  });
});
