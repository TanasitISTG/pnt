import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCompletion, createResponse } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
  createResponse: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createCompletion } };
    responses = { create: createResponse };
  },
}));

import { OpenAIProviderClient } from "./provider-client";

const source = readFileSync(
  fileURLToPath(new URL("./provider-client.ts", import.meta.url)),
  "utf8",
);

beforeEach(() => {
  createCompletion.mockReset();
  createResponse.mockReset();
  createCompletion.mockResolvedValue({
    choices: [{ message: { content: "translated" } }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  });
  createResponse.mockResolvedValue({
    output_text: "translated",
    usage: { input_tokens: 12, output_tokens: 34 },
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
  it.each([
    "https://opencode.ai/zen/v1",
    "https://opencode.ai/zen/go/v1",
    "https://opencode.ai/zen/v1/responses",
  ])("uses non-streaming Responses API for OpenCode Luna (%s)", async (baseUrl) => {
    const client = new OpenAIProviderClient({
      apiKey: "test-key",
      baseUrl,
      model: "gpt-5.6-luna",
      temperature: 0.4,
      reasoningEffort: "low",
    });

    const result = await client.generateChatCompletion({
      messages: [
        { role: "system", content: "Translate into Thai." },
        { role: "user", content: "Translate this." },
      ],
      maxTokens: 128,
      responseFormat: { type: "json_object" },
    });

    expect(createCompletion).not.toHaveBeenCalled();
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        input: [
          { role: "system", content: "Translate into Thai." },
          { role: "user", content: "Translate this." },
        ],
        max_output_tokens: 128,
        reasoning: { effort: "low" },
        text: { format: { type: "json_object" } },
        stream: false,
      }),
    );
    expect(createResponse.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
    expect(result).toEqual({
      content: "translated",
      usage: { promptTokens: 12, completionTokens: 34 },
    });
  });

  it("applies the configured reasoning effort to OpenAI-compatible requests", async () => {
    const client = new OpenAIProviderClient({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "o4-mini",
      temperature: 0.4,
      reasoningEffort: "high",
    });

    await client.generateChatCompletion({
      messages: [{ role: "user", content: "Translate this." }],
    });

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "o4-mini",
        reasoning_effort: "high",
      }),
    );
  });

  it("lets an explicit reasoning setting override provider compatibility defaults", async () => {
    const client = new OpenAIProviderClient({
      apiKey: "test-key",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-flash",
      temperature: 0.4,
      reasoningEffort: "none",
    });

    await client.generateChatCompletion({
      messages: [{ role: "user", content: "Translate this." }],
    });

    expect(createCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning_effort: "none",
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
