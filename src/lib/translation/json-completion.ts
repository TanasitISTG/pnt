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
  } catch (error) {
    if (!isJsonModeUnsupportedError(error)) throw error;

    const result = await providerConfig.generateChatCompletion({
      temperature,
      model,
      messages,
    });
    return toResult(result, true);
  }
}

function isJsonModeUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as Record<string, unknown>;
  const status = [candidate.status, candidate.statusCode].find(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (status !== undefined && status !== 400 && status !== 422) return false;

  const text = [candidate.message, candidate.code, candidate.param, candidate.type]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const mentionsJsonMode =
    text.includes("response_format") ||
    text.includes("responseformat") ||
    text.includes("json_object") ||
    text.includes("responsemimetype") ||
    text.includes("application/json");
  const describesUnsupportedMode =
    text.includes("unsupported") ||
    text.includes("not supported") ||
    text.includes("unknown") ||
    text.includes("unrecognized") ||
    text.includes("invalid") ||
    text.includes("not allowed");
  return mentionsJsonMode && describesUnsupportedMode;
}

function toResult(result: ChatCompletionResult, usedPlainFallback: boolean): JsonCompletionResult {
  return {
    content: result.content || "",
    promptTokens: result.usage?.promptTokens || 0,
    completionTokens: result.usage?.completionTokens || 0,
    usedPlainFallback,
  };
}
