import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import * as jobStore from "@/lib/translation/job-store";
import * as providerClientModule from "@/lib/translation/provider-client";
import * as titleModule from "@/lib/translation/title";
import type { AIProviderClient } from "@/lib/translation/translation.types";
import { translateMissingTitlesForUser } from "./chapter-ops.service";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));
vi.mock("@/lib/translation/job-store", () => ({ loadApprovedTermsForContext: vi.fn() }));
vi.mock("@/lib/translation/provider-client", () => ({ createProviderClient: vi.fn() }));
vi.mock("@/lib/translation/title", () => ({ translateChapterTitle: vi.fn() }));
vi.mock("@/lib/translation/outbox", () => ({
  dispatchTranslationOutboxEventBestEffort: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("translateMissingTitlesForUser", () => {
  it("retries provider setup and passes approved terms with the novel prompt", async () => {
    const novel = {
      id: "novel-1",
      userId: "user-1",
      sourceLang: "zh",
      targetLang: "th",
      customPrompt: "Keep chapter titles concise.",
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
      },
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ translatedTitle: "บทที่หนึ่ง สวี่เหยี่ยกลับมา" }),
    );
  });
});
