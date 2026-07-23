import { describe, it, expect } from "vitest";
import { chunkText } from "./chunker";

describe("chunker module", () => {
  it("returns empty array for empty or whitespace text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns single chunk for short text", () => {
    const text = "Hello world. This is a simple test chapter.";
    const chunks = chunkText(text, 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].index).toBe(0);
  });

  it("preserves exact text when re-joining chunks", () => {
    const text = "Paragraph 1 line 1.\nParagraph 1 line 2.\n\nParagraph 2 line 1.\n\nParagraph 3.";
    const chunks = chunkText(text, 30);
    const joined = chunks.map((c) => c.text).join("");
    expect(joined).toBe(text);
  });

  it("splits at paragraph boundaries when target size exceeded", () => {
    const p1 = "A".repeat(30) + "\n\n";
    const p2 = "B".repeat(30) + "\n\n";
    const p3 = "C".repeat(30);
    const text = p1 + p2 + p3;
    const chunks = chunkText(text, 40);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it("falls back to sentence splitting for long single paragraphs", () => {
    const text = "Sentence one. Sentence two. Sentence three. Sentence four.";
    const chunks = chunkText(text, 28);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
  });

  it("hard splits sentences that exceed target size", () => {
    const longWord = "X".repeat(100);
    const chunks = chunkText(longWord, 30);
    expect(chunks).toHaveLength(4);
    expect(chunks[0].text.length).toBe(30);
    expect(chunks[3].text.length).toBe(10);
    expect(chunks.map((c) => c.text).join("")).toBe(longWord);
  });

  it("handles CJK and Thai text gracefully", () => {
    const thaiText = "สวัสดีครับ นี่คือบททดสอบการแปลนิยายภาษาไทย\n\nบรรทัดที่สองของบททดสอบ";
    const chunks = chunkText(thaiText, 25);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((c) => c.text).join("")).toBe(thaiText);
  });
});
