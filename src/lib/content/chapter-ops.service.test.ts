import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import * as jobStore from "@/lib/translation/workflow/job-store";
import * as providerClientModule from "@/lib/translation/providers/provider-client";
import * as titleModule from "@/lib/translation/workflow/title";
import type { AIProviderClient } from "@/lib/translation/types/provider";
import { relationshipMapSchema } from "@/lib/relationships/schemas";
import { translateMissingTitlesForUser } from "./chapter-ops.service";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));
vi.mock("@/lib/translation/workflow/job-store", () => ({ loadApprovedTermsForContext: vi.fn() }));
vi.mock("@/lib/translation/providers/provider-client", () => ({ createProviderClient: vi.fn() }));
vi.mock("@/lib/translation/workflow/title", () => ({ translateChapterTitle: vi.fn() }));
vi.mock("@/lib/translation/workflow/outbox", () => ({
  dispatchTranslationOutboxEventBestEffort: vi.fn(),
}));

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

beforeEach(() => {
  vi.resetAllMocks();
});

describe("translateMissingTitlesForUser", () => {
  it.each([
    {
      label: "valid",
      relationshipMapJson: JSON.stringify(relationshipMap),
      expectedRelationshipMap: relationshipMap,
    },
    {
      label: "invalid",
      relationshipMapJson: "not json",
      expectedRelationshipMap: null,
    },
  ])(
    "retries provider setup and passes approved terms, $label map, and novel prompt",
    async ({ relationshipMapJson, expectedRelationshipMap }) => {
      const novel = {
        id: "novel-1",
        userId: "user-1",
        sourceLang: "zh",
        targetLang: "th",
        customPrompt: "Keep chapter titles concise.",
        relationshipMapJson,
      };
      const missing = [{ id: "chapter-1", title: "第一章 许野归来" }];
      const approvedTerms = [
        { source: "许野", target: "สวี่เหยี่ย", category: "character" as const, note: null },
        { source: "白云宗", target: "สำนักเมฆาขาว", category: "place" as const, note: null },
      ];
      const providerConfig = {
        provider: "openai",
        model: "main-model",
        fastModel: "fast-model",
        temperature: 0.7,
        baseUrl: "http://localhost",
        generateChatCompletion: vi.fn(),
      } as AIProviderClient;
      const novelLimit = vi.fn().mockResolvedValue([novel]);
      const missingLimit = vi.fn().mockResolvedValue(missing);
      const updateWhere = vi.fn().mockResolvedValue([]);
      const updateSet = vi.fn(() => ({ where: updateWhere }));

      vi.mocked(db.select)
        .mockReturnValueOnce({
          from: () => ({ where: () => ({ limit: novelLimit }) }),
        } as never)
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({ orderBy: () => ({ limit: missingLimit }) }),
          }),
        } as never);
      vi.mocked(db.update).mockReturnValue({ set: updateSet } as never);
      vi.mocked(providerClientModule.createProviderClient)
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValueOnce(providerConfig);
      vi.mocked(jobStore.loadApprovedTermsForContext).mockResolvedValue(approvedTerms);
      vi.mocked(titleModule.translateChapterTitle).mockResolvedValue({
        translated: "บทที่หนึ่ง สวี่เหยี่ยกลับมา",
        promptTokens: 3,
        completionTokens: 2,
      });

      const result = await translateMissingTitlesForUser("user-1", "novel-1");

      expect(result).toEqual({ translated: 1 });
      expect(providerClientModule.createProviderClient).toHaveBeenCalledTimes(4);
      expect(jobStore.loadApprovedTermsForContext).toHaveBeenCalledTimes(1);
      expect(jobStore.loadApprovedTermsForContext).toHaveBeenCalledWith("novel-1");
      expect(titleModule.translateChapterTitle).toHaveBeenCalledWith(
        providerConfig,
        "zh->th",
        "第一章 许野归来",
        {
          glossaryTerms: approvedTerms,
          customPrompt: "Keep chapter titles concise.",
          relationshipMap: expectedRelationshipMap,
        },
      );
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ translatedTitle: "บทที่หนึ่ง สวี่เหยี่ยกลับมา" }),
      );
    },
  );
});
