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
const openAIConfig = {
  apiKey: "test-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  temperature: 0.4,
};

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
  it.each([
    [{ choices: [] }],
    [{ choices: [{ message: { content: 12 } }] }],
    [
      {
        choices: [{ message: { content: "translated" } }],
        usage: { prompt_tokens: -1, completion_tokens: 2 },
      },
    ],
    [
      {
        choices: [{ message: { content: "translated" } }],
        usage: { prompt_tokens: 1, completion_tokens: Number.NaN },
      },
    ],
    [
      {
        choices: [{ message: { content: "translated" } }],
        usage: { prompt_tokens: 1.5, completion_tokens: 2 },
      },
    ],
    [
      {
        choices: [{ message: { content: "translated" } }],
        usage: { prompt_tokens: 2_147_483_648, completion_tokens: 2 },
      },
    ],
  ])("rejects malformed Chat Completions responses with a fixed error", async (payload) => {
    createCompletion.mockResolvedValueOnce(payload);
    const client = new OpenAIProviderClient(openAIConfig);

    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Invalid provider response",
    });
  });

  it.each([
    [{ usage: { input_tokens: 1, output_tokens: 2 } }],
    [{ output_text: 17, usage: { input_tokens: 1, output_tokens: 2 } }],
    [{ output_text: "translated", usage: { input_tokens: -1, output_tokens: 2 } }],
    [{ output_text: "translated", usage: { input_tokens: 1, output_tokens: "2" } }],
    [{ output_text: "translated", usage: { input_tokens: 2_147_483_648, output_tokens: 2 } }],
  ])("rejects malformed Responses API values with a fixed error", async (payload) => {
    createResponse.mockResolvedValueOnce(payload);
    const client = new OpenAIProviderClient({
      ...openAIConfig,
      baseUrl: "https://opencode.ai/zen/v1",
      model: "gpt-5.6-luna",
    });

    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Invalid provider response",
    });
  });

  it("accepts valid nullable Chat Completions content and absent usage", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });
    const client = new OpenAIProviderClient(openAIConfig);

    await expect(client.generateChatCompletion({ messages: [] })).resolves.toEqual({
      content: "",
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  });

  it.each([
    [401, "AUTH_FAILED", "Provider authentication failed. Check the API key."],
    [
      403,
      "ACCESS_DENIED",
      "Provider denied access. Check account/model permissions and deployment IP restrictions.",
    ],
    [404, "NOT_FOUND", "Provider endpoint or model was not found."],
    [429, "RATE_LIMITED", "Provider rate limit reached. Try again later."],
    [
      500,
      "CONNECTION_FAILED",
      "Could not connect to the provider. Check the settings and try again.",
    ],
  ])("maps OpenAI HTTP %s without exposing upstream details", async (status, code, message) => {
    createCompletion.mockRejectedValueOnce(
      Object.assign(new Error("secret-key in upstream body"), {
        status,
        error: { message: "secret-key in upstream body" },
      }),
    );
    const client = new OpenAIProviderClient(openAIConfig);

    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      code,
      status,
      message,
    });
  });

  it("maps secret-bearing transport failures and timeouts to fixed errors", async () => {
    const client = new OpenAIProviderClient(openAIConfig);
    createCompletion.mockRejectedValueOnce(new Error("https://user:secret@upstream.example"));
    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "Could not connect to the provider. Check the settings and try again.",
    });

    createCompletion.mockRejectedValueOnce(
      Object.assign(new Error("secret timeout body"), { name: "APIConnectionTimeoutError" }),
    );
    await expect(client.generateChatCompletion({ messages: [] })).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Provider request timed out.",
    });
  });

  it("uses plain fallback only for clear OpenAI JSON-mode rejection", async () => {
    const client = new OpenAIProviderClient(openAIConfig);
    createCompletion.mockRejectedValueOnce(
      Object.assign(new Error("secret: response_format is not supported by this model"), {
        status: 400,
        param: "response_format",
      }),
    );

    await expect(generateJsonCompletion(client, 0, [])).resolves.toMatchObject({
      content: "translated",
      usedPlainFallback: true,
    });
    expect(createCompletion).toHaveBeenCalledTimes(2);

    createCompletion.mockRejectedValueOnce(
      Object.assign(new Error("secret: invalid model"), { status: 400 }),
    );
    await expect(generateJsonCompletion(client, 0, [])).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
      message: "Could not connect to the provider. Check the settings and try again.",
    });
    expect(createCompletion).toHaveBeenCalledTimes(3);
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
    { usageMetadata: { promptTokenCount: 1.5 } },
    { usageMetadata: { candidatesTokenCount: 2_147_483_648 } },
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
    [
      403,
      "Provider denied access. Check account/model permissions and deployment IP restrictions.",
    ],
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

  it("preserves timeouts while reading a Gemini JSON-mode error body", async () => {
    const response = new Response(null, { status: 400 });
    vi.spyOn(response, "json").mockRejectedValueOnce(
      new DOMException("secret upstream timeout", "TimeoutError"),
    );
    createGeminiContent.mockResolvedValueOnce(response);
    const client = new GeminiProviderClient({ apiKey: "key", model: "test", temperature: 0 });

    await expect(
      client.generateChatCompletion({
        messages: [],
        responseFormat: { type: "json_object" },
      }),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Provider request timed out.",
    });
  });
});
