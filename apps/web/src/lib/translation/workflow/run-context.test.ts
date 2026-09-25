import { beforeEach, describe, expect, it, vi } from "vitest";

import * as jobStore from "./job-store";
import { loadTranslationRunContext, resolveContextTailLength } from "./run-context";

vi.mock("./job-store", () => ({
  loadApprovedTermsForContext: vi.fn(),
  loadPrevChapterContext: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("translation run context", () => {
  it("loads approved terms and previous-chapter tails once per run", async () => {
    const terms = [{ source: "许野", target: "สวี่เหยี่ย", category: "character", note: null }];
    const previousChapter = { summary: "Prev", rawTail: "raw", translatedTail: "translated" };
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue(terms as never);
    vi.mocked(jobStore.loadPrevChapterContext).mockResolvedValue(previousChapter as never);

    await expect(
      loadTranslationRunContext({ id: "novel-1", contextTailLength: 500 }, { number: "3" }),
    ).resolves.toEqual({ terms, previousChapter });

    expect(jobStore.loadApprovedTermsForContext).toHaveBeenCalledWith("novel-1");
    expect(jobStore.loadPrevChapterContext).toHaveBeenCalledWith("novel-1", "3", 500);
  });

  it("uses the default tail length when the novel has none", async () => {
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue([]);
    vi.mocked(jobStore.loadPrevChapterContext).mockResolvedValue(null as never);

    await expect(
      loadTranslationRunContext({ id: "novel-1", contextTailLength: null }, { number: "1" }),
    ).resolves.toEqual({ terms: [], previousChapter: null });

    expect(jobStore.loadPrevChapterContext).toHaveBeenCalledWith("novel-1", "1", 500);
  });

  it("resolves configured and blank tail lengths to one default", () => {
    expect(resolveContextTailLength(1200)).toBe(1200);
    expect(resolveContextTailLength(0)).toBe(500);
    expect(resolveContextTailLength(null)).toBe(500);
  });

  it("never hands SQL a length it would reject", async () => {
    vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue([]);
    vi.mocked(jobStore.loadPrevChapterContext).mockResolvedValue(null as never);

    expect(resolveContextTailLength(-20)).toBe(500);
    expect(resolveContextTailLength(500.5)).toBe(500);
    expect(resolveContextTailLength(Number.NaN)).toBe(500);
    expect(resolveContextTailLength(Number.POSITIVE_INFINITY)).toBe(500);

    await loadTranslationRunContext({ id: "novel-1", contextTailLength: -20 }, { number: "1" });
    expect(jobStore.loadPrevChapterContext).toHaveBeenCalledWith("novel-1", "1", 500);
  });
});
