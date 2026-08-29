import { beforeEach, describe, expect, it, vi } from "vitest";

import * as titleModule from "./title";
import { generateSummaryArtifacts } from "./finalize-summary";
import type { AIProviderClient } from "../types/provider";
import type { GlossaryTermInput } from "../types/glossary";
import type { LogEntry } from "../types/workflow";

vi.mock("./title", () => ({ translateChapterTitle: vi.fn() }));

function makeProvider(
  generateChatCompletion: AIProviderClient["generateChatCompletion"],
): AIProviderClient {
  return {
    provider: "openai",
    model: "main-model",
    fastModel: "fast-model",
    temperature: 0.7,
    baseUrl: "http://localhost",
    generateChatCompletion,
  };
}

const novel = {
  id: "novel-1",
  sourceLang: "zh",
  targetLang: "th",
  storySummary: "Existing story",
  customPrompt: "Keep names consistent.",
} as never;
const chapter = { id: "chapter-1", title: "第一章" } as never;
const approvedTerms: GlossaryTermInput[] = [
  { source: "许野", target: "สวี่เหยี่ย", category: "character" },
];

function completion(content: string) {
  return { content, usage: { promptTokens: 3, completionTokens: 2 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(titleModule.translateChapterTitle).mockResolvedValue({
    translated: "บทที่หนึ่ง",
    promptTokens: 1,
    completionTokens: 1,
  });
});

describe("generateSummaryArtifacts", () => {
  it("retries chapter and rolling summaries independently", async () => {
    const generateChatCompletion = vi
      .fn()
      .mockRejectedValueOnce(new Error("chapter timeout"))
      .mockRejectedValueOnce(new Error("chapter timeout"))
      .mockRejectedValueOnce(new Error("chapter timeout"))
      .mockResolvedValueOnce(completion("Chapter summary"))
      .mockRejectedValueOnce(new Error("story timeout"))
      .mockRejectedValueOnce(new Error("story timeout"))
      .mockRejectedValueOnce(new Error("story timeout"))
      .mockResolvedValueOnce(completion("Updated story"));
    const logs: LogEntry[] = [];

    const result = await generateSummaryArtifacts({
      providerConfig: makeProvider(generateChatCompletion),
      novel,
      chapter,
      fullTranslation: "Translated chapter",
      approvedTerms,
      logs,
    });

    expect(result).toEqual({
      translatedTitle: "บทที่หนึ่ง",
      freshSummary: "Chapter summary",
      updatedStorySummary: "Updated story",
      promptTokens: 7,
      completionTokens: 5,
    });
    expect(generateChatCompletion).toHaveBeenCalledTimes(8);
    expect(titleModule.translateChapterTitle).toHaveBeenCalledWith(
      expect.anything(),
      "zh->th",
      "第一章",
      { glossaryTerms: approvedTerms, customPrompt: "Keep names consistent." },
    );
  });

  it("keeps the title when chapter summary retries are exhausted", async () => {
    const generateChatCompletion = vi.fn().mockRejectedValue(new Error("summary unavailable"));
    const logs: LogEntry[] = [];

    const result = await generateSummaryArtifacts({
      providerConfig: makeProvider(generateChatCompletion),
      novel,
      chapter,
      fullTranslation: "Translated chapter",
      approvedTerms: [],
      logs,
    });

    expect(result.translatedTitle).toBe("บทที่หนึ่ง");
    expect(result.freshSummary).toBeUndefined();
    expect(result.updatedStorySummary).toBeUndefined();
    expect(generateChatCompletion).toHaveBeenCalledTimes(4);
    expect(logs.some((entry) => entry.message.includes("Summary generation skipped"))).toBe(true);
  });

  it("keeps the chapter summary when rolling summary retries are exhausted", async () => {
    const generateChatCompletion = vi
      .fn()
      .mockResolvedValueOnce(completion("Chapter summary"))
      .mockRejectedValue(new Error("story unavailable"));
    const logs: LogEntry[] = [];

    const result = await generateSummaryArtifacts({
      providerConfig: makeProvider(generateChatCompletion),
      novel,
      chapter,
      fullTranslation: "Translated chapter",
      approvedTerms: [],
      logs,
    });

    expect(result.translatedTitle).toBe("บทที่หนึ่ง");
    expect(result.freshSummary).toBe("Chapter summary");
    expect(result.updatedStorySummary).toBeUndefined();
    expect(generateChatCompletion).toHaveBeenCalledTimes(5);
    expect(
      logs.some((entry) => entry.message.includes("Rolling story summary update skipped")),
    ).toBe(true);
  });
});
