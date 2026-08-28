import { APIConnectionTimeoutError } from "openai";
import { describe, expect, it, vi } from "vitest";

import { generateJsonCompletion } from "./json-completion";
import type { AIProviderClient } from "./translation.types";

function provider(responses: unknown[]): AIProviderClient {
  return {
    provider: "openai",
    model: "main-model",
    fastModel: "fast-model",
    temperature: 0.7,
    baseUrl: "http://localhost",
    generateChatCompletion: vi.fn(async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error("missing test response");
      return {
        content: JSON.stringify(response),
        usage: { promptTokens: 3, completionTokens: 2 },
      };
    }),
  };
}

describe("generateJsonCompletion", () => {
  it("uses the fast model and JSON response mode", async () => {
    const client = provider([{ ok: true }]);
    const result = await generateJsonCompletion(client, 0.1, [{ role: "user", content: "hello" }]);
    expect(result).toMatchObject({
      content: '{"ok":true}',
      promptTokens: 3,
      completionTokens: 2,
      usedPlainFallback: false,
    });
    expect(client.generateChatCompletion).toHaveBeenCalledWith({
      temperature: 0.1,
      model: "fast-model",
      messages: [{ role: "user", content: "hello" }],
      responseFormat: { type: "json_object" },
    });
  });

  it("retries plain completion when JSON mode is rejected", async () => {
    const client = provider([new Error("response_format unsupported"), { terms: [] }]);
    const result = await generateJsonCompletion(client, 0.3, [
      { role: "system", content: "terms" },
    ]);
    expect(result.content).toBe('{"terms":[]}');
    expect(result.usedPlainFallback).toBe(true);
    expect(client.generateChatCompletion).toHaveBeenCalledTimes(2);
    expect(client.generateChatCompletion).toHaveBeenLastCalledWith({
      temperature: 0.3,
      model: "fast-model",
      messages: [{ role: "system", content: "terms" }],
    });
  });

  it("does not retry connection timeouts", async () => {
    const timeout = new APIConnectionTimeoutError({ message: "request timed out" });
    const client = provider([timeout]);

    await expect(
      generateJsonCompletion(client, 0.3, [{ role: "system", content: "terms" }]),
    ).rejects.toBe(timeout);
    expect(client.generateChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("does not retry authentication failures", async () => {
    const authentication = Object.assign(new Error("response_format unsupported"), {
      status: 401,
    });
    const client = provider([authentication]);

    await expect(
      generateJsonCompletion(client, 0.3, [{ role: "system", content: "terms" }]),
    ).rejects.toBe(authentication);
    expect(client.generateChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("uses the main model when no fast model is configured", async () => {
    const client = provider([{ ok: true }]);
    client.fastModel = null;
    await generateJsonCompletion(client, 0.1, []);
    expect(client.generateChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ model: "main-model" }),
    );
  });
});
