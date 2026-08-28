import type { AIProviderClient, ChatCompletionResult, ChatMessage } from "./translation.types";

export interface JsonCompletionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  usedPlainFallback: boolean;
}

/**
 * Request structured output when supported, then retry without JSON mode for
 * OpenAI-compatible providers that reject response_format.
 */
export async function generateJsonCompletion(
  providerConfig: AIProviderClient,
  temperature: number,
  messages: ChatMessage[],
): Promise<JsonCompletionResult> {
  const model = providerConfig.fastModel ?? providerConfig.model;
  try {
    const result = await providerConfig.generateChatCompletion({
      temperature,
      model,
      messages,
      responseFormat: { type: "json_object" },
    });
    return toResult(result, false);
  } catch {
    const result = await providerConfig.generateChatCompletion({
      temperature,
      model,
      messages,
    });
    return toResult(result, true);
  }
}

function toResult(result: ChatCompletionResult, usedPlainFallback: boolean): JsonCompletionResult {
  return {
    content: result.content || "",
    promptTokens: result.usage?.promptTokens || 0,
    completionTokens: result.usage?.completionTokens || 0,
    usedPlainFallback,
  };
}
