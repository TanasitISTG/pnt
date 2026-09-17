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

    if (isOpenCodeLunaModel(model, this.baseUrl)) {
      const response = await this.client.responses.create({
        model,
        input: options.messages,
        max_output_tokens: options.maxTokens,
        reasoning: this.reasoningEffort ? { effort: this.reasoningEffort } : undefined,
        text: options.responseFormat ? { format: options.responseFormat } : undefined,
        stream: false,
      });

      return {
        content: response.output_text || "",
        usage: {
          promptTokens: response.usage?.input_tokens || 0,
          completionTokens: response.usage?.output_tokens || 0,
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

    return {
      content: completion.choices[0]?.message?.content || "",
      usage: {
        promptTokens: completion.usage?.prompt_tokens || 0,
        completionTokens: completion.usage?.completion_tokens || 0,
      },
    };
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
      promptTokenCount: z.number().finite().nonnegative().optional(),
      candidatesTokenCount: z.number().finite().nonnegative().optional(),
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
          const envelope: unknown = await response.json().catch(() => null);
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
          response.status === 401 || response.status === 403
            ? "Provider authentication failed. Check the API key."
            : response.status === 404
              ? "Provider endpoint or model was not found."
              : response.status === 429
                ? "Provider rate limit reached. Try again later."
                : "Could not connect to the provider. Check the settings and try again.",
          unsupportedJson ? "JSON_MODE_UNSUPPORTED" : "HTTP_ERROR",
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
      if (
        signal.aborted ||
        (error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "APIConnectionTimeoutError"))
      ) {
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
