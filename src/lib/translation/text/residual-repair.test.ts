import { describe, expect, it } from "vitest";

import { findResidualSourceChars } from "./residual";
import { extractHanziSpans, spliceSpans } from "./residual-repair";

describe("extractHanziSpans", () => {
  it("finds maximal spans with correct offsets", () => {
    const spans = extractHanziSpans("abc虎哥def送嘉年华ghi");
    expect(spans).toEqual([
      { start: 3, end: 5, text: "虎哥" },
      { start: 8, end: 12, text: "送嘉年华" },
    ]);
  });

  it("excludes cjk punctuation brackets (same class as residual detector)", () => {
    const spans = extractHanziSpans("สวัสดี【虎哥送嘉年华】ครับ");
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("虎哥送嘉年华");
  });

  it("shares the residual class with the detector", () => {
    expect(findResidualSourceChars("zh->th", "ไทย许野")).toHaveLength(2);
    expect(extractHanziSpans("ไทย许野")).toEqual([{ start: 3, end: 5, text: "许野" }]);
  });
  it("returns empty on clean text", () => {
    expect(extractHanziSpans("ข้อความไทยล้วน pure Thai")).toEqual([]);
  });
});

describe("spliceSpans", () => {
  it("splices replacements of different lengths without corrupting offsets", () => {
    const text = "abc虎哥def送嘉年华ghi";
    const spans = extractHanziSpans(text);
    expect(spliceSpans(text, spans, ["BroHu", "sends a carnival"])).toBe(
      "abcBroHudefsends a carnivalghi",
    );
  });

  it("returns null on count mismatch", () => {
    const spans = extractHanziSpans("虎哥");
    expect(spliceSpans("虎哥", spans, [])).toBeNull();
  });

  it("passes text through when there is nothing to replace", () => {
    expect(spliceSpans("clean", [], [])).toBe("clean");
  });
});
