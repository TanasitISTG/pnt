import { describe, expect, it } from "vitest";

import { scanResidualScripts, sourceTagsArePreserved, spliceResidualSpans } from "./residual";

describe("scanResidualScripts", () => {
  it("allows Thai output and groups foreign scripts on one line", () => {
    expect(scanResidualScripts("en->th", "ภาษาไทย 123! 😀 ||¶||")).toEqual({
      spans: [],
      letterCount: 0,
    });

    expect(scanResidualScripts("zh->th", "ภาษาไทย")).toEqual({
      spans: [],
      letterCount: 0,
    });

    expect(scanResidualScripts("en->th", "ภาษาไทย Hello мир مرحبا")).toEqual({
      spans: [{ start: 8, end: 23, text: "Hello мир مرحبا", letterCount: 13 }],
      letterCount: 13,
    });
  });

  it("detects representative non-Thai scripts and supplementary letters", () => {
    for (const sample of ["漢", "мир", "مرحبا", "Γεια", "שלום", "ພາສາ", "かな", "한글", "𐐀"]) {
      expect(scanResidualScripts("zh->th", sample).letterCount).toBeGreaterThan(0);
    }
  });

  it("allows accented and decomposed Latin for English output", () => {
    expect(scanResidualScripts("zh->en", "English café cafe\u0301")).toEqual({
      spans: [],
      letterCount: 0,
    });
  });

  it("detects Thai, Han, Cyrillic, and Arabic in English output", () => {
    const result = scanResidualScripts("zh->en", "ไทย 中文 мир مرحبا");
    expect(result.letterCount).toBe(13);
    expect(result.spans.map((span) => span.text)).toEqual(["ไทย 中文 мир مرحبا"]);
  });

  it("keeps spans line-bounded and excludes neutral edge characters", () => {
    const result = scanResidualScripts("en->th", "ไทย Hello, world\nмир مرحبا");
    expect(result.spans).toEqual([
      { start: 4, end: 16, text: "Hello, world", letterCount: 10 },
      { start: 17, end: 26, text: "мир مرحبا", letterCount: 8 },
    ]);
  });

  it("keeps combining marks adjacent to a foreign base letter", () => {
    const result = scanResidualScripts("en->th", "ไทย مرحبا\u0650 จบ");
    expect(result.spans).toEqual([{ start: 4, end: 10, text: "مرحبا\u0650", letterCount: 5 }]);
  });

  it("protects exact glossary targets and source tags only", () => {
    const result = scanResidualScripts("en->th", "<em>OpenAI</em> OpenAI OpenAIs <foo>", {
      sourceText: "<em>OpenAI</em>",
      protectedTerms: ["OpenAI"],
    });
    expect(result.spans.map((span) => span.text)).toEqual(["s <foo"]);
    expect(result.letterCount).toBe(4);
  });

  it("detects near matches and model-invented tags", () => {
    expect(
      scanResidualScripts("en->th", "OpenAIs", { protectedTerms: ["openai"] }).letterCount,
    ).toBe(7);
    expect(
      scanResidualScripts("en->th", "<notice>bad</notice>", { sourceText: "<em>bad</em>" })
        .letterCount,
    ).toBeGreaterThan(0);
  });

  it("uses UTF-16 offsets for supplementary-plane letters", () => {
    expect(scanResidualScripts("en->th", "ไทย 𐐀 ไทย").spans).toEqual([
      { start: 4, end: 6, text: "𐐀", letterCount: 1 },
    ]);
  });

  it("falls back to Thai validation for unknown pairs", () => {
    expect(scanResidualScripts("unknown", "hello").letterCount).toBe(5);
  });
});
describe("sourceTagsArePreserved", () => {
  it("requires the exact source tag sequence without omissions or additions", () => {
    expect(sourceTagsArePreserved("<em>原文</em>", "<em>ภาษาไทย</em>")).toBe(true);
    expect(sourceTagsArePreserved("<em>原文</em>", "ภาษาไทย")).toBe(false);
    expect(sourceTagsArePreserved("<em>原文</em>", "<strong>ภาษาไทย</strong>")).toBe(false);
    expect(sourceTagsArePreserved("<em>原文</em>", "<em><em>ภาษาไทย</em></em>")).toBe(false);
  });
});

describe("spliceResidualSpans", () => {
  it("splices replacement lengths without corrupting later offsets", () => {
    const text = "ไทย Hello ไทย мир";
    const spans = scanResidualScripts("en->th", text).spans;
    expect(spliceResidualSpans(text, spans, ["สวัสดี", "โลก"])).toBe("ไทย สวัสดี ไทย โลก");
  });

  it("returns null on count mismatch", () => {
    const spans = scanResidualScripts("en->th", "Hello").spans;
    expect(spliceResidualSpans("Hello", spans, [])).toBeNull();
  });

  it("passes clean text through", () => {
    expect(spliceResidualSpans("ภาษาไทย", [], [])).toBe("ภาษาไทย");
  });
});
