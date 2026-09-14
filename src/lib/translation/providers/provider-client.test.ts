import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCompletion, createResponse, createGeminiContent } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
  createResponse: vi.fn(),
  createGeminiContent: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createCompletion } };
    responses = { create: createResponse };
  },
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: createGeminiContent };
  },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings/crypto", () => ({ decrypt: vi.fn() }));

import { GeminiProviderClient, OpenAIProviderClient } from "./provider-client";

beforeEach(() => {
  createCompletion.mockReset();
  createResponse.mockReset();
  createGeminiContent.mockReset();
  createCompletion.mockResolvedValue({
    choices: [{ message: { content: "translated" } }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  });
  createResponse.mockResolvedValue({
    output_text: "translated",
    usage: { input_tokens: 12, output_tokens: 34 },
  });
  createGeminiContent.mockResolvedValue({
    text: "translated",
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
  });
});

describe("provider-client module", () => {
  it("handles Gemini system instructions and response format", async () => {
    const client = new GeminiProviderClient({
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com",
      model: "gemini-2.5-flash",
      temperature: 0.4,
    });

    const result = await client.generateChatCompletion({
      messages: [
        { role: "system", content: "Translate into Thai." },
        { role: "user", content: "Translate this." },
      ],
      maxTokens: 128,
      responseFormat: { type: "json_object" },
    });

    expect(createGeminiContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: "Translate this." }] }],
        config: expect.objectContaining({
          systemInstruction: "Translate into Thai.",
          maxOutputTokens: 128,
          responseMimeType: "application/json",
        }),
      }),
    );
    expect(result).toEqual({
      content: "translated",
      usage: { promptTokens: 12, completionTokens: 34 },
    });
  });

  it("preserves fast model and pricing snapshot fields on clients", () => {
    const client = new OpenAIProviderClient({
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      fastModel: "gpt-4o-mini",
      temperature: 0.4,
      inputPricePer1M: 2.5,
      outputPricePer1M: 10,
    });

    expect(client.fastModel).toBe("gpt-4o-mini");
    expect(client.inputPricePer1M).toBe(2.5);
    expect(client.outputPricePer1M).toBe(10);
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
