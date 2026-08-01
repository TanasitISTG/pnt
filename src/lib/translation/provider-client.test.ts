import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCompletion } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createCompletion } };
  },
}));

import { OpenAIProviderClient } from "./provider-client";

const source = readFileSync(
  fileURLToPath(new URL("./provider-client.ts", import.meta.url)),
  "utf8",
);

beforeEach(() => {
  createCompletion.mockReset();
  createCompletion.mockResolvedValue({
    choices: [{ message: { content: "translated" } }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  });
});

describe("provider-client module", () => {
  it("exports OpenAIProviderClient and GeminiProviderClient classes", () => {
    expect(source).toContain("export class OpenAIProviderClient");
    expect(source).toContain("export class GeminiProviderClient");
  });

  it("supports provider type selection in createProviderClient", () => {
    expect(source).toContain('provider === "gemini"');
    expect(source).toContain("new GeminiProviderClient");
    expect(source).toContain("new OpenAIProviderClient");
  });

  it("handles Gemini system instructions and response format", () => {
    expect(source).toContain("systemInstruction:");
    expect(source).toContain(
      'responseMimeType:\n          options.responseFormat?.type === "json_object" ? "application/json" : undefined',
    );
  });

  it("extracts token counts from Gemini usageMetadata", () => {
    expect(source).toContain("response.usageMetadata?.promptTokenCount");
    expect(source).toContain("response.usageMetadata?.candidatesTokenCount");
  });

  it("passes fastModel configuration to provider clients", () => {
    expect(source).toContain("fastModel?: string | null");
    expect(source).toContain("fastModel: settings.fastModel");
  });

  it("bounds OpenCode Go DeepSeek Flash reasoning for translation", async () => {
    const client = new OpenAIProviderClient({
      apiKey: "test-key",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-flash",
      temperature: 0.4,
    });

    await client.generateChatCompletion({
      messages: [{ role: "user", content: "Translate this." }],
    });

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "deepseek-v4-flash",
        max_tokens: 8192,
        reasoning_effort: "low",
      }),
    );
  });

  it("does not change compatibility options for other providers", async () => {
    const client = new OpenAIProviderClient({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "deepseek-v4-flash",
      temperature: 0.4,
    });

    await client.generateChatCompletion({
      messages: [{ role: "user", content: "Translate this." }],
    });

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: undefined,
        reasoning_effort: undefined,
      }),
    );
  });
});
