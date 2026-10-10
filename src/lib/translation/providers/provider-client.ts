import "@tanstack/react-start/server-only";
import OpenAI from "openai";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { providerSettings } from "@/lib/db/schema";
import { decrypt } from "@/lib/settings/crypto";
import type {
  AIProviderClient,
  ChatCompletionOptions,
  ChatCompletionResult,
  ProviderType,
  ReasoningEffort,
} from "@/lib/providers/types";
import { MAX_PERSISTED_TOKEN_COUNT } from "@/lib/translation/token-count";
import { OPEN_CODE_GO_BASE_URL, isOpenCodeLunaModel } from "./provider-compatibility";
import {
  assertProviderBaseUrl,
  createProviderFetch,
  normalizeProviderBaseUrl,
  ProviderRequestError,
} from "./provider-network.server";

export class ProviderNotConfiguredError extends Error {
  constructor(message = "AI provider settings are not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderSnapshotMismatchError extends Error {
  constructor() {
    super("The configured AI provider changed after this job was queued; retry the job.");
    this.name = "ProviderSnapshotMismatchError";
  }
}
const tokenCountSchema = z.number().int().nonnegative().max(MAX_PERSISTED_TOKEN_COUNT);
const openAIChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: tokenCountSchema,
      completion_tokens: tokenCountSchema,
    })
    .nullish(),
});
const openAIResponseSchema = z.object({
  output_text: z.string(),
  usage: z
    .object({
      input_tokens: tokenCountSchema,
      output_tokens: tokenCountSchema,
    })
    .nullish(),
});

const providerFailureMessages = {
  AUTH_FAILED: "Provider authentication failed. Check the API key.",
  ACCESS_DENIED:
    "Provider denied access. Check account/model permissions and deployment IP restrictions.",
  NOT_FOUND: "Provider endpoint or model was not found.",
  RATE_LIMITED: "Provider rate limit reached. Try again later.",
  TIMEOUT: "Provider request timed out.",
  CONNECTION_FAILED: "Could not connect to the provider. Check the settings and try again.",
  JSON_MODE_UNSUPPORTED: "Provider does not support JSON response mode.",
} as const;

function providerErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  return [candidate.status, candidate.statusCode].find(
    (value): value is number => typeof value === "number" && Number.isInteger(value),
  );
}

function isUnsupportedJsonModeError(error: unknown, status: number | undefined): boolean {
  if ((status !== 400 && status !== 422) || !error || typeof error !== "object") return false;
  try {
    const candidate = error as Record<string, unknown>;
    const nested =
      candidate.error && typeof candidate.error === "object"
        ? (candidate.error as Record<string, unknown>)
        : undefined;
    const text = [
      candidate.message,
      candidate.code,
      candidate.param,
      candidate.type,
      nested?.message,
      nested?.code,
      nested?.param,
      nested?.type,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    const responseFormat = String.raw`(?:response[_ ]?format|json[_ ]?object|json response mode)`;
    const unsupported = String.raw`(?:unsupported|not supported|does not support|unknown|unrecognized|not allowed)`;
    return (
      new RegExp(`${responseFormat}.{0,100}${unsupported}`).test(text) ||
      new RegExp(`${unsupported}.{0,100}${responseFormat}`).test(text)
    );
  } catch {
    return false;
  }
}

function isTimeoutError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const candidate = current as Error & { cause?: unknown };
    const constructorName = candidate.constructor?.name;
    if (
      candidate.name === "TimeoutError" ||
      candidate.name === "ConnectTimeoutError" ||
      candidate.name === "APIConnectionTimeoutError" ||
      constructorName === "TimeoutError" ||
      constructorName === "ConnectTimeoutError" ||
      constructorName === "APIConnectionTimeoutError"
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function mapOpenAIError(error: unknown, jsonModeRequested: boolean): ProviderRequestError {
  if (error instanceof ProviderRequestError) return error;
  const status = providerErrorStatus(error);
  if (jsonModeRequested && isUnsupportedJsonModeError(error, status)) {
    return new ProviderRequestError(
      providerFailureMessages.JSON_MODE_UNSUPPORTED,
      "JSON_MODE_UNSUPPORTED",
      status,
    );
  }
  if (status === 401) {
    return new ProviderRequestError(providerFailureMessages.AUTH_FAILED, "AUTH_FAILED", status);
  }
  if (status === 403) {
    return new ProviderRequestError(providerFailureMessages.ACCESS_DENIED, "ACCESS_DENIED", status);
  }
  if (status === 404) {
    return new ProviderRequestError(providerFailureMessages.NOT_FOUND, "NOT_FOUND", status);
  }
  if (status === 429) {
    return new ProviderRequestError(providerFailureMessages.RATE_LIMITED, "RATE_LIMITED", status);
  }
  if (isTimeoutError(error)) {
    return new ProviderRequestError(providerFailureMessages.TIMEOUT, "TIMEOUT");
  }
  return new ProviderRequestError(
    providerFailureMessages.CONNECTION_FAILED,
    "CONNECTION_FAILED",
    status,
  );
}

export class OpenAIProviderClient implements AIProviderClient {
  provider: ProviderType = "openai";
  model: string;
  fastModel?: string | null;
  temperature: number;
  reasoningEffort?: ReasoningEffort | null;
  baseUrl: string;
  inputPricePer1M?: number | null;
  outputPricePer1M?: number | null;
  requestTimeoutSec?: number | null;
  private client: OpenAI;
  constructor(config: {
    apiKey: string;
    baseUrl: string;
    model: string;
    fastModel?: string | null;
    temperature: number;
    reasoningEffort?: ReasoningEffort | null;
    requestTimeoutSec?: number | null;
    inputPricePer1M?: number | null;
    outputPricePer1M?: number | null;
  }) {
    this.model = config.model;
    this.fastModel = config.fastModel;
    this.inputPricePer1M = config.inputPricePer1M;
    this.outputPricePer1M = config.outputPricePer1M;
    this.temperature = config.temperature;
    this.reasoningEffort = config.reasoningEffort;
    this.baseUrl = normalizeProviderBaseUrl(config.baseUrl, "openai");
    this.requestTimeoutSec = config.requestTimeoutSec;
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: config.apiKey,
      timeout: (config.requestTimeoutSec ?? 240) * 1000,
      maxRetries: 0,
      fetch: createProviderFetch(this.baseUrl),
    });
  }

  async generateChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const model = options.model ?? this.model;

    try {
      if (isOpenCodeLunaModel(model, this.baseUrl)) {
        const response = await this.client.responses.create({
          model,
          input: options.messages,
          max_output_tokens: options.maxTokens,
          reasoning: this.reasoningEffort ? { effort: this.reasoningEffort } : undefined,
          text: options.responseFormat ? { format: options.responseFormat } : undefined,
          stream: false,
        });
        const parsed = openAIResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new ProviderRequestError("Invalid provider response", "INVALID_RESPONSE");
        }

        return {
          content: parsed.data.output_text,
          usage: {
            promptTokens: parsed.data.usage?.input_tokens ?? 0,
            completionTokens: parsed.data.usage?.output_tokens ?? 0,
          },
        };
      }

      const isOpenCodeGoFlash =
        model === "deepseek-v4-flash" && this.baseUrl === OPEN_CODE_GO_BASE_URL;
      const completion = await this.client.chat.completions.create({
        model,
        temperature: options.temperature ?? this.temperature,
        max_tokens: options.maxTokens ?? (isOpenCodeGoFlash ? 8192 : undefined),
        messages: options.messages,
        response_format: options.responseFormat,
        reasoning_effort: this.reasoningEffort ?? (isOpenCodeGoFlash ? "low" : undefined),
      });
      const parsed = openAIChatResponseSchema.safeParse(completion);
      if (!parsed.success) {
        throw new ProviderRequestError("Invalid provider response", "INVALID_RESPONSE");
      }

      return {
        content: parsed.data.choices[0].message.content ?? "",
        usage: {
          promptTokens: parsed.data.usage?.prompt_tokens ?? 0,
          completionTokens: parsed.data.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      throw mapOpenAIError(error, options.responseFormat?.type === "json_object");
    }
  }
}

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(z.object({ text: z.string().optional(), thought: z.boolean().optional() }))
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: tokenCountSchema.optional(),
      candidatesTokenCount: tokenCountSchema.optional(),
    })
    .optional(),
});
const geminiErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
});

export class GeminiProviderClient implements AIProviderClient {
  provider: ProviderType = "gemini";
  model: string;
  fastModel?: string | null;
  temperature: number;
  baseUrl: string;
  inputPricePer1M?: number | null;
  outputPricePer1M?: number | null;
  requestTimeoutSec?: number | null;
  private apiKey: string;
  private fetch: typeof globalThis.fetch;

  constructor(config: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    fastModel?: string | null;
    temperature: number;
    requestTimeoutSec?: number | null;
    inputPricePer1M?: number | null;
    outputPricePer1M?: number | null;
  }) {
    this.model = config.model;
    this.fastModel = config.fastModel;
    this.inputPricePer1M = config.inputPricePer1M;
    this.outputPricePer1M = config.outputPricePer1M;
    this.temperature = config.temperature;
    this.baseUrl = normalizeProviderBaseUrl(config.baseUrl ?? "", "gemini");
    this.requestTimeoutSec = config.requestTimeoutSec;
    if (config.apiKey.startsWith("auth_tokens/")) {
      throw new ProviderRequestError(
        "Provider authentication failed. Check the API key.",
        "AUTH_FAILED",
      );
    }
    this.apiKey = config.apiKey;
    this.fetch = createProviderFetch(this.baseUrl);
  }

  async generateChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const systemInstructionParts: string[] = [];
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const msg of options.messages) {
      if (msg.role === "system") {
        systemInstructionParts.push(msg.content);
      } else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const model = options.model ?? this.model;
    if (!model || /\.\.|[?&]/.test(model) || model.split("/").some((part) => !part)) {
      throw new ProviderRequestError("Provider model is invalid", "INVALID_MODEL");
    }
    const resource =
      model.startsWith("models/") || model.startsWith("tunedModels/") ? model : `models/${model}`;
    const url = new URL(this.baseUrl);
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1beta/${resource.split("/").map(encodeURIComponent).join("/")}:generateContent`;
    const signal = AbortSignal.timeout((this.requestTimeoutSec ?? 240) * 1000);
    try {
      const response = await this.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        signal,
        body: JSON.stringify({
          contents,
          systemInstruction: systemInstructionParts.length
            ? {
                role: "user",
                parts: [{ text: systemInstructionParts.join("\n\n") }],
              }
            : undefined,
          generationConfig: {
            temperature: options.temperature ?? this.temperature,
            maxOutputTokens: options.maxTokens,
            responseMimeType:
              options.responseFormat?.type === "json_object" ? "application/json" : undefined,
          },
        }),
      });
      if (!response.ok) {
        let unsupportedJson = false;
        if (
          (response.status === 400 || response.status === 422) &&
          options.responseFormat?.type === "json_object"
        ) {
          let envelope: unknown;
          try {
            envelope = await response.json();
          } catch (error) {
            if (signal.aborted || error instanceof ProviderRequestError || isTimeoutError(error)) {
              throw error;
            }
            envelope = null;
          }
          const parsed = geminiErrorSchema.safeParse(envelope);
          if (parsed.success) {
            const text = [parsed.data.error?.message, parsed.data.error?.status]
              .join(" ")
              .toLowerCase();
            unsupportedJson =
              /responsemimetype|application\/json/.test(text) &&
              /unsupported|not supported|unknown|unrecognized|invalid|not allowed/.test(text);
          }
        } else {
          await response.body?.cancel().catch(() => undefined);
        }
        throw new ProviderRequestError(
          response.status === 401
            ? providerFailureMessages.AUTH_FAILED
            : response.status === 403
              ? providerFailureMessages.ACCESS_DENIED
              : response.status === 404
                ? providerFailureMessages.NOT_FOUND
                : response.status === 429
                  ? providerFailureMessages.RATE_LIMITED
                  : providerFailureMessages.CONNECTION_FAILED,
          unsupportedJson
            ? "JSON_MODE_UNSUPPORTED"
            : response.status === 401
              ? "AUTH_FAILED"
              : response.status === 403
                ? "ACCESS_DENIED"
                : "HTTP_ERROR",
          response.status,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ProviderRequestError("Invalid provider response", "INVALID_RESPONSE");
      }
      const parsed = geminiResponseSchema.safeParse(payload);
      if (!parsed.success)
        throw new ProviderRequestError("Invalid provider response", "INVALID_RESPONSE");
      const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
      return {
        content: parts
          .filter((part) => part.thought !== true && typeof part.text === "string")
          .map((part) => part.text)
          .join(""),
        usage: {
          promptTokens: parsed.data.usageMetadata?.promptTokenCount || 0,
          completionTokens: parsed.data.usageMetadata?.candidatesTokenCount || 0,
        },
      };
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      if (signal.aborted || isTimeoutError(error)) {
        throw new ProviderRequestError("Provider request timed out.", "TIMEOUT");
      }
      throw new ProviderRequestError(
        "Could not connect to the provider. Check the settings and try again.",
        "CONNECTION_FAILED",
      );
    }
  }
}

export interface ProviderClientOverrides {
  provider?: ProviderType;
  model?: string;
  fastModel?: string | null;
}

export async function createProviderClient(
  userId: string,
  overrides: ProviderClientOverrides = {},
): Promise<AIProviderClient> {
  const [settings] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1);

  if (!settings || !settings.apiKeyEnc) {
    throw new ProviderNotConfiguredError();
  }

  const apiKey = decrypt(settings.apiKeyEnc);
  const configuredProvider = (settings.provider as ProviderType) ?? "openai";
  if (overrides.provider && overrides.provider !== configuredProvider) {
    throw new ProviderSnapshotMismatchError();
  }
  const provider = overrides.provider ?? configuredProvider;
  const baseUrl = await assertProviderBaseUrl(settings.baseUrl, provider);
  const model = overrides.model ?? settings.model;
  const fastModel = "fastModel" in overrides ? overrides.fastModel : settings.fastModel;
  const pricing = {
    inputPricePer1M: settings.inputPricePer1M,
    outputPricePer1M: settings.outputPricePer1M,
  };

  if (provider === "gemini") {
    return new GeminiProviderClient({
      apiKey,
      baseUrl,
      model,
      fastModel,
      temperature: settings.temperature,
      requestTimeoutSec: settings.requestTimeoutSec,
      ...pricing,
    });
  }

  return new OpenAIProviderClient({
    apiKey,
    baseUrl,
    model,
    fastModel,
    reasoningEffort: settings.reasoningEffort as ReasoningEffort | null,
    temperature: settings.temperature,
    requestTimeoutSec: settings.requestTimeoutSec,
    ...pricing,
  });
}
export interface ProviderRuntimeSnapshot {
  provider: ProviderType;
  model: string;
  fastModel: string | null;
  inputPricePer1M: number | null;
  outputPricePer1M: number | null;
}

export interface StoredProviderSnapshot {
  provider?: string | null;
  model?: string | null;
  fastModel?: string | null;
}

export interface ProviderRuntime {
  client: AIProviderClient;
  snapshot: ProviderRuntimeSnapshot;
}

export async function loadProviderRuntime(userId: string): Promise<ProviderRuntime> {
  const client = await createProviderClient(userId);
  return {
    client,
    snapshot: {
      provider: client.provider,
      model: client.model,
      fastModel: client.fastModel ?? null,
      inputPricePer1M: client.inputPricePer1M ?? null,
      outputPricePer1M: client.outputPricePer1M ?? null,
    },
  };
}

export async function loadProviderRuntimeForJob(
  userId: string,
  storedSnapshot: StoredProviderSnapshot,
): Promise<AIProviderClient> {
  if (storedSnapshot.provider == null || storedSnapshot.model == null) {
    return createProviderClient(userId);
  }
  if (storedSnapshot.provider !== "openai" && storedSnapshot.provider !== "gemini") {
    throw new ProviderSnapshotMismatchError();
  }
  return createProviderClient(userId, {
    provider: storedSnapshot.provider,
    model: storedSnapshot.model,
    fastModel: storedSnapshot.fastModel ?? null,
  });
}
