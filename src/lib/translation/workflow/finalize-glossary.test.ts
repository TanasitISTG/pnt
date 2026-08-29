import { beforeEach, describe, expect, it, vi } from "vitest";

import * as jobStore from "./job-store";
import { suggestAndReviewTerms } from "./finalize-glossary";
import * as jsonCompletion from "../providers/json-completion";
import type { AIProviderClient } from "../types/provider";
import type { ChunkProgress, LogEntry } from "../types/workflow";

vi.mock("./job-store", () => ({
  loadTermSourcesForExclusion: vi.fn(),
}));
vi.mock("../providers/json-completion", () => ({
  generateJsonCompletion: vi.fn(),
}));

describe("suggestAndReviewTerms", () => {
  const novel = {
    id: "novel-1",
    sourceLang: "zh",
    targetLang: "th",
  } as never;
  const providerConfig = {} as AIProviderClient;
  const chunkList: ChunkProgress[] = [{ index: 0, text: "许野 手机", translation: "" }];
  const fullTranslation = "สวี่เหยี่ย โทรศัพท์";
  const extractionResponse = JSON.stringify({
    terms: [
      { source: "许野", target: "สวี่เหยี่ย", category: "character" },
      { source: "手机", target: "โทรศัพท์", category: "item" },
    ],
  });
  const approvedReviewResponse = JSON.stringify({
    reviews: [
      {
        source: "许野",
        target: "สวี่เหยี่ย",
        termType: "named_entity",
        action: "approve",
        confidence: "high",
        reason: "Named character",
      },
      {
        source: "手机",
        target: "โทรศัพท์",
        termType: "generic",
        action: "reject",
        confidence: "high",
        reason: "Everyday object",
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(jobStore.loadTermSourcesForExclusion).mockResolvedValue({
      approvedTerms: [],
      existingSources: [],
    });
  });

  it("inserts only a source-evidenced named entity", async () => {
    vi.mocked(jsonCompletion.generateJsonCompletion)
      .mockResolvedValueOnce({
        content: extractionResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: approvedReviewResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      });

    const result = await suggestAndReviewTerms({
      providerConfig,
      novel,
      chunkList,
      fullTranslation,
      logs: [],
    });

    expect(result.rowsToInsert).toHaveLength(1);
    expect(result.rowsToInsert[0]).toEqual(
      expect.objectContaining({
        novelId: "novel-1",
        source: "许野",
        target: "สวี่เหยี่ย",
        category: "character",
        status: "approved",
      }),
    );
    expect(result.approvedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
  });
  it("retries malformed extraction before reviewing terms", async () => {
    vi.mocked(jsonCompletion.generateJsonCompletion)
      .mockResolvedValueOnce({
        content: JSON.stringify({ terms: [{ source: "Missing target" }] }),
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: "not json",
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ unexpected: [] }),
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: extractionResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: approvedReviewResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      });

    const result = await suggestAndReviewTerms({
      providerConfig,
      novel,
      chunkList,
      fullTranslation,
      logs: [],
    });

    expect(jsonCompletion.generateJsonCompletion).toHaveBeenCalledTimes(5);
    expect(result.rowsToInsert).toHaveLength(1);
    expect(result.approvedCount).toBe(1);
  });

  it("does not retry a valid empty extraction", async () => {
    vi.mocked(jsonCompletion.generateJsonCompletion).mockResolvedValueOnce({
      content: JSON.stringify({ terms: [] }),
      promptTokens: 10,
      completionTokens: 5,
      usedPlainFallback: false,
    });

    const result = await suggestAndReviewTerms({
      providerConfig,
      novel,
      chunkList,
      fullTranslation,
      logs: [],
    });

    expect(jsonCompletion.generateJsonCompletion).toHaveBeenCalledTimes(1);
    expect(result.rowsToInsert).toEqual([]);
    expect(result.rejectedCount).toBe(0);
  });

  it("saves no rows when review fails after four retries", async () => {
    vi.mocked(jsonCompletion.generateJsonCompletion)
      .mockResolvedValueOnce({
        content: extractionResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockRejectedValueOnce(new Error("review unavailable"))
      .mockRejectedValueOnce(new Error("review unavailable"))
      .mockRejectedValueOnce(new Error("review unavailable"))
      .mockRejectedValueOnce(new Error("review unavailable"));
    const logs: LogEntry[] = [];

    const result = await suggestAndReviewTerms({
      providerConfig,
      novel,
      chunkList,
      fullTranslation,
      logs,
    });

    expect(result).toEqual(
      expect.objectContaining({
        rowsToInsert: [],
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 2,
      }),
    );
    expect(jsonCompletion.generateJsonCompletion).toHaveBeenCalledTimes(5);
    expect(logs.some((entry) => entry.message.includes("no suggestions saved"))).toBe(true);
  });
  it("saves no rows when review returns malformed JSON", async () => {
    vi.mocked(jsonCompletion.generateJsonCompletion)
      .mockResolvedValueOnce({
        content: extractionResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: "not json",
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: "still not json",
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: "{}",
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: "[]",
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      });

    const result = await suggestAndReviewTerms({
      providerConfig,
      novel,
      chunkList,
      fullTranslation,
      logs: [],
    });

    expect(result.rowsToInsert).toEqual([]);
    expect(result.rejectedCount).toBe(2);
    expect(jsonCompletion.generateJsonCompletion).toHaveBeenCalledTimes(5);
  });

  it("saves no rows for review output from the old schema", async () => {
    vi.mocked(jsonCompletion.generateJsonCompletion)
      .mockResolvedValueOnce({
        content: extractionResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          reviews: [
            {
              source: "许野",
              target: "สวี่เหยี่ย",
              action: "approve",
              confidence: "high",
              reason: "Old schema",
            },
            {
              source: "手机",
              target: "โทรศัพท์",
              action: "reject",
              confidence: "high",
              reason: "Old schema",
            },
          ],
        }),
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      });

    const result = await suggestAndReviewTerms({
      providerConfig,
      novel,
      chunkList,
      fullTranslation,
      logs: [],
    });

    expect(result.rowsToInsert).toEqual([]);
    expect(result.approvedCount).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.rejectedCount).toBe(2);
  });
  it("deduplicates and caps candidates before requesting AI review", async () => {
    const terms = Array.from({ length: 10 }, (_, index) => ({
      source: `Term ${index}`,
      target: `Target ${index}`,
      category: "other",
    }));
    const oversizedExtractionResponse = JSON.stringify({
      terms: [...terms, { source: "Ｔｅｒｍ  0", target: "Duplicate", category: "other" }],
    });
    const sourceText = terms.map((term) => term.source).join(" ");
    const translatedText = terms.map((term) => term.target).join(" ");
    vi.mocked(jsonCompletion.generateJsonCompletion)
      .mockResolvedValueOnce({
        content: oversizedExtractionResponse,
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({ reviews: [] }),
        promptTokens: 10,
        completionTokens: 5,
        usedPlainFallback: false,
      });

    await suggestAndReviewTerms({
      providerConfig,
      novel,
      chunkList: [{ index: 0, text: sourceText }],
      fullTranslation: translatedText,
      logs: [],
    });

    const reviewMessages = vi.mocked(jsonCompletion.generateJsonCompletion).mock.calls[1]?.[2];
    const reviewUserMessage = reviewMessages?.find((message) => message.role === "user")?.content;
    expect(reviewUserMessage?.match(/"source":/g)).toHaveLength(8);
    expect(reviewUserMessage).toContain('"source": "Term 7"');
    expect(reviewUserMessage).not.toContain('"source": "Term 8"');
    expect(reviewUserMessage).not.toContain('"source": "Ｔｅｒｍ  0"');
  });
});
