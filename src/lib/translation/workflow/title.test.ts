import { describe, expect, it, vi } from "vitest";

import type { ProviderClientConfig } from "../types/provider";
import { translateChapterTitle } from "./title";
import { relationshipMapSchema } from "@/lib/relationships/schemas";

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

const relationshipMap = relationshipMapSchema.parse({
  version: 1,
  characters: [
    {
      id: "hero",
      sourceName: "许野",
      targetName: "สวี่เหยี่ย",
      aliases: [],
      gender: "male",
      role: "protagonist",
      notes: null,
      enabled: true,
      locked: false,
      evidence: null,
      lastSeenChapter: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "friend",
      sourceName: "林月",
      targetName: "หลินเยว่",
      aliases: [],
      gender: "female",
      role: null,
      notes: null,
      enabled: true,
      locked: false,
      evidence: null,
      lastSeenChapter: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "unrelated",
      sourceName: "顾青",
      targetName: "กู้ชิง",
      aliases: [],
      gender: "unknown",
      role: null,
      notes: null,
      enabled: true,
      locked: false,
      evidence: null,
      lastSeenChapter: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  relationships: [
    {
      id: "hero-to-friend",
      speakerId: "hero",
      listenerId: "friend",
      relationship: "friend",
      speakerStatus: "peer",
      familiarity: "close",
      selfPronoun: null,
      addresseeTerm: null,
      sentenceParticles: null,
      register: null,
      notes: null,
      enabled: true,
      locked: false,
      evidence: null,
      lastSeenChapter: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
});

describe("translateChapterTitle", () => {
  it("retries transient failures and injects matching title context", async () => {
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
      "第一章 许野与林月归来",
      {
        glossaryTerms: [
          { source: "许野", target: "สวี่เหยี่ย", category: "character" },
          { source: "白云宗", target: "สำนักเมฆาขาว", category: "place" },
        ],
        customPrompt: "Keep the title concise.",
        relationshipMap,
      },
    );

    expect(result).toEqual({ translated: "许野归来", promptTokens: 4, completionTokens: 2 });
    expect(generateChatCompletion).toHaveBeenCalledTimes(4);

    const prompt = generateChatCompletion.mock.calls[0]?.[0]?.messages[0]?.content as string;
    expect(prompt).toContain("## Terminology & Glossary");
    expect(prompt).toContain("许野 -> สวี่เหยี่ย");
    expect(prompt).not.toContain("白云宗 -> สำนักเมฆาขาว");
    expect(prompt).toContain("## Character & Relationship Context");
    expect(prompt).toContain('"sourceName":"许野"');
    expect(prompt).toContain('"sourceName":"林月"');
    expect(prompt).toContain('"id":"hero-to-friend"');
    expect(prompt).not.toContain("顾青");
    expect(prompt).not.toContain("unrelated");
    expect(prompt).toContain("## Custom Instructions");
    expect(prompt).toContain("Keep the title concise.");
    expect(prompt.indexOf("## Terminology & Glossary")).toBeLessThan(
      prompt.indexOf("## Character & Relationship Context"),
    );
    expect(prompt.indexOf("## Character & Relationship Context")).toBeLessThan(
      prompt.indexOf("## Custom Instructions"),
    );
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
