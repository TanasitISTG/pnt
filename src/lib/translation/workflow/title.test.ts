import { describe, expect, it, vi } from "vitest";

import type { ProviderClientConfig } from "../types/provider";
import { translateChapterTitle } from "./title";

function makeProvider(
  generateChatCompletion: ProviderClientConfig["generateChatCompletion"],
): ProviderClientConfig {
  return {
    provider: "openai",
    model: "main-model",
    fastModel: "fast-model",
    temperature: 0.7,
    baseUrl: "http://localhost",
    generateChatCompletion,
  } as ProviderClientConfig;
}

describe("translateChapterTitle", () => {
  it("retries transient failures and injects matching glossary context", async () => {
    const generateChatCompletion = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        content: "许野归来",
        usage: { promptTokens: 4, completionTokens: 2 },
      });

    const result = await translateChapterTitle(
      makeProvider(generateChatCompletion),
      "zh->th",
      "第一章 许野归来",
      {
        glossaryTerms: [
          { source: "许野", target: "สวี่เหยี่ย", category: "character" },
          { source: "白云宗", target: "สำนักเมฆาขาว", category: "place" },
        ],
        customPrompt: "Keep the title concise.",
      },
    );

    expect(result).toEqual({ translated: "许野归来", promptTokens: 4, completionTokens: 2 });
    expect(generateChatCompletion).toHaveBeenCalledTimes(4);

    const prompt = generateChatCompletion.mock.calls[0]?.[0]?.messages[0]?.content as string;
    expect(prompt).toContain("## Terminology & Glossary");
    expect(prompt).toContain("许野 -> สวี่เหยี่ย");
    expect(prompt).not.toContain("白云宗 -> สำนักเมฆาขาว");
    expect(prompt).toContain("## Custom Instructions");
    expect(prompt).toContain("Keep the title concise.");
    expect(prompt.slice(prompt.indexOf("Output ONLY the translated title"))).not.toContain("\n## ");
  });

  it("omits optional title context when values are blank", async () => {
    const generateChatCompletion = vi.fn().mockResolvedValue({
      content: "Translated title",
      usage: { promptTokens: 1, completionTokens: 1 },
    });

    await translateChapterTitle(makeProvider(generateChatCompletion), "en->th", "Chapter one", {
      glossaryTerms: [],
      customPrompt: "  ",
    });

    const prompt = generateChatCompletion.mock.calls[0]?.[0]?.messages[0]?.content as string;
    expect(prompt).not.toContain("## Terminology & Glossary");
    expect(prompt).not.toContain("## Custom Instructions");
  });

  it("retains usage from blank responses after retry exhaustion", async () => {
    const generateChatCompletion = vi.fn().mockResolvedValue({
      content: "   ",
      usage: { promptTokens: 2, completionTokens: 1 },
    });

    const result = await translateChapterTitle(
      makeProvider(generateChatCompletion),
      "zh->th",
      "第一章",
    );

    expect(result).toEqual({ translated: null, promptTokens: 8, completionTokens: 4 });
    expect(generateChatCompletion).toHaveBeenCalledTimes(4);
  });
});
