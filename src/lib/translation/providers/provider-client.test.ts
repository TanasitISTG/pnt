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

vi.mock("undici", () => ({
  Agent: class {},
  buildConnector: vi.fn(),
  fetch: createGeminiContent,
}));
vi.mock("@/lib/env", () => ({
  env: { LOCAL_PROVIDER_ORIGINS: [] },
  parseLocalProviderOrigins: JSON.parse,
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings/crypto", () => ({ decrypt: vi.fn() }));

import { GeminiProviderClient, OpenAIProviderClient } from "./provider-client";
import { generateJsonCompletion } from "@/lib/providers/json-completion";

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
  createGeminiContent.mockImplementation(async () =>
    Response.json({
      candidates: [{ content: { parts: [{ text: "translated" }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
    }),
  );
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

    const [url, request] = createGeminiContent.mock.calls[0];
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    );
    expect(request.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-key",
    });
    expect(JSON.parse(request.body)).toEqual({
      contents: [{ role: "user", parts: [{ text: "Translate this." }] }],
      systemInstruction: { role: "user", parts: [{ text: "Translate into Thai." }] },
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 128,
        responseMimeType: "application/json",
      },
    });
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

  it("retains custom base paths and model resources without exposing thought output", async () => {
    createGeminiContent.mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { text: "hidden", thought: true },
                { text: "A" },
                { inlineData: {} },
                { text: "B" },
              ],
            },
          },
          { content: { parts: [{ text: "other" }] } },
        ],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5, thoughtsTokenCount: 99 },
      }),
    );
    const client = new GeminiProviderClient({
      apiKey: "key",
      baseUrl: "https://gateway.example/gemini/",
      model: "unused",
      temperature: 0.4,
    });
    const result = await client.generateChatCompletion({
      model: "tunedModels/custom",
      temperature: 0.7,
      responseFormat: { type: "text" },
      messages: [
        { role: "system", content: "" },
        { role: "user", content: "one" },
        { role: "system", content: "two" },
        { role: "assistant", content: "three" },
      ],
    });
    const [url, request] = createGeminiContent.mock.calls[0];
    expect(String(url)).toBe(
      "https://gateway.example/gemini/v1beta/tunedModels/custom:generateContent",
    );
    expect(JSON.parse(request.body)).toEqual({
      contents: [
        { role: "user", parts: [{ text: "one" }] },
        { role: "model", parts: [{ text: "three" }] },
      ],
      systemInstruction: { role: "user", parts: [{ text: "\n\ntwo" }] },
      generationConfig: { temperature: 0.7 },
    });
    expect(result).toEqual({ content: "AB", usage: { promptTokens: 3, completionTokens: 5 } });
  });

  it.each([
    {},
    { candidates: [] },
    { candidates: [{ content: { parts: [{ thought: true, text: "secret" }] } }] },
  ])("accepts absent visible output", async (payload) => {
    createGeminiContent.mockResolvedValueOnce(Response.json(payload));
    const client = new GeminiProviderClient({
      apiKey: "key",
      model: "models/test",
      temperature: 0,
    });
    expect(await client.generateChatCompletion({ messages: [] })).toEqual({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  });

  it.each([
    { candidates: "bad" },
    { candidates: [{ content: { parts: [{ text: 1 }] } }] },
    { usageMetadata: { promptTokenCount: -1 } },
    { usageMetadata: { candidatesTokenCount: "3" } },
  ])("rejects malformed response fields safely", async (payload) => {
    createGeminiContent.mockResolvedValueOnce(Response.json(payload));
    const client = new GeminiProviderClient({ apiKey: "key", model: "test", temperature: 0 });
    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Invalid provider response",
    });
  });

  it.each([
    [401, "Provider authentication failed. Check the API key."],
    [403, "Provider authentication failed. Check the API key."],
    [404, "Provider endpoint or model was not found."],
    [429, "Provider rate limit reached. Try again later."],
    [500, "Could not connect to the provider. Check the settings and try again."],
  ])("maps HTTP %s without upstream details", async (status, message) => {
    createGeminiContent.mockResolvedValueOnce(
      new Response("secret upstream URL/key", { status: Number(status) }),
    );
    const client = new GeminiProviderClient({ apiKey: "key", model: "test", temperature: 0 });
    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      status,
      message,
    });
  });

  it("preserves narrow JSON fallback and timeout detection", async () => {
    const client = new GeminiProviderClient({ apiKey: "key", model: "test", temperature: 0 });
    createGeminiContent.mockResolvedValueOnce(
      Response.json(
        { error: { message: "responseMimeType application/json is not supported" } },
        { status: 400 },
      ),
    );
    createGeminiContent.mockResolvedValueOnce(
      Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
    );
    expect(await generateJsonCompletion(client, 0, [])).toMatchObject({
      content: "{}",
      usedPlainFallback: true,
    });
    createGeminiContent.mockResolvedValueOnce(
      Response.json({ error: { message: "invalid model" } }, { status: 400 }),
    );
    await expect(generateJsonCompletion(client, 0, [])).rejects.toMatchObject({
      code: "HTTP_ERROR",
    });
    createGeminiContent.mockRejectedValueOnce(new DOMException("upstream secret", "TimeoutError"));
    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Provider request timed out.",
    });
  });
});
