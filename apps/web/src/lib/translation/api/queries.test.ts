import { describe, expect, it, vi } from "vitest";

import { resolveTranslationJobRuntime } from "./queries";

describe("translation job runtime details", () => {
  it("keeps a complete snapshot immutable and does not consult current settings", async () => {
    const loadCurrentModel = vi.fn().mockResolvedValue("new-current-model");

    await expect(
      resolveTranslationJobRuntime(
        { provider: "openai", model: "historical-model" },
        loadCurrentModel,
      ),
    ).resolves.toEqual({
      provider: "openai",
      model: "historical-model",
      isLegacyProviderFallback: false,
    });
    expect(loadCurrentModel).not.toHaveBeenCalled();
  });

  it.each([
    { provider: null, model: null },
    { provider: "openai", model: null },
    { provider: null, model: "legacy-model" },
  ])("uses the owner's current model for an incomplete legacy snapshot", async (snapshot) => {
    const loadCurrentModel = vi.fn().mockResolvedValue("owner-current-model");

    await expect(resolveTranslationJobRuntime(snapshot, loadCurrentModel)).resolves.toEqual({
      provider: null,
      model: "owner-current-model",
      isLegacyProviderFallback: true,
    });
    expect(loadCurrentModel).toHaveBeenCalledOnce();
  });

  it.each([null, undefined, "  "])(
    "uses a generic model label when current settings are absent (%s)",
    async (currentModel) => {
      const loadCurrentModel = vi.fn().mockResolvedValue(currentModel);

      await expect(
        resolveTranslationJobRuntime({ provider: null, model: null }, loadCurrentModel),
      ).resolves.toEqual({
        provider: null,
        model: "AI Provider",
        isLegacyProviderFallback: true,
      });
    },
  );

  it("returns only non-secret runtime metadata", async () => {
    const details = await resolveTranslationJobRuntime(
      { provider: "openai", model: "historical-model" },
      vi.fn(),
    );

    expect(Object.keys(details)).toEqual(["provider", "model", "isLegacyProviderFallback"]);
    expect(details).not.toHaveProperty("apiKey");
    expect(details).not.toHaveProperty("apiKeyEnc");
  });
});
