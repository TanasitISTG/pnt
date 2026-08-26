import "@tanstack/react-start/server-only";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { providerSettings } from "@/lib/db/schema";
import { decrypt } from "@/lib/translation/crypto";
import type {
  AIProviderClient,
  ChatCompletionOptions,
  ChatCompletionResult,
  ProviderType,
  ReasoningEffort,
} from "./translation.types";
import {
  OPEN_CODE_GO_BASE_URL,
  isOpenCodeLunaModel,
  normalizeOpenCodeBaseUrl,
} from "./provider-compatibility";

export class ProviderNotConfiguredError extends Error {
  constructor(message = "AI provider settings are not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export class OpenAIProviderClient implements AIProviderClient {
  provider: ProviderType = "openai";
  model: string;
  fastModel?: string | null;
  temperature: number;
  reasoningEffort?: ReasoningEffort | null;
  baseUrl: string;
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
  }) {
    this.model = config.model;
    this.fastModel = config.fastModel;
    this.temperature = config.temperature;
    this.reasoningEffort = config.reasoningEffort;
    this.baseUrl = normalizeOpenCodeBaseUrl(config.baseUrl);
    this.requestTimeoutSec = config.requestTimeoutSec;
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: config.apiKey,
      timeout: (config.requestTimeoutSec ?? 240) * 1000,
      maxRetries: 0,
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

export class GeminiProviderClient implements AIProviderClient {
  provider: ProviderType = "gemini";
  model: string;
  fastModel?: string | null;
  temperature: number;
  baseUrl: string;
  requestTimeoutSec?: number | null;
  private ai: GoogleGenAI;

  constructor(config: {
    apiKey: string;
    baseUrl?: string;
    model: string;
    fastModel?: string | null;
    temperature: number;
    requestTimeoutSec?: number | null;
  }) {
    this.model = config.model;
    this.fastModel = config.fastModel;
    this.temperature = config.temperature;
    this.baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com";
    this.requestTimeoutSec = config.requestTimeoutSec;
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: {
        ...(config.baseUrl && config.baseUrl !== "https://generativelanguage.googleapis.com"
          ? { baseUrl: config.baseUrl }
          : {}),
        timeout: (config.requestTimeoutSec ?? 240) * 1000,
      },
    });
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

    const response = await this.ai.models.generateContent({
      model: options.model ?? this.model,
      contents,
      config: {
        systemInstruction:
          systemInstructionParts.length > 0 ? systemInstructionParts.join("\n\n") : undefined,
        temperature: options.temperature ?? this.temperature,
        maxOutputTokens: options.maxTokens,
        responseMimeType:
          options.responseFormat?.type === "json_object" ? "application/json" : undefined,
      },
    });

    return {
      content: response.text || "",
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }
}

export async function createProviderClient(userId: string): Promise<AIProviderClient> {
  const [settings] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1);

  if (!settings || !settings.apiKeyEnc) {
    throw new ProviderNotConfiguredError();
  }

  const apiKey = decrypt(settings.apiKeyEnc);
  const provider = (settings.provider as ProviderType) || "openai";

  if (provider === "gemini") {
    return new GeminiProviderClient({
      apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      fastModel: settings.fastModel,
      temperature: settings.temperature,
      requestTimeoutSec: settings.requestTimeoutSec,
    });
  }

  return new OpenAIProviderClient({
    apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    fastModel: settings.fastModel,
    reasoningEffort: settings.reasoningEffort as ReasoningEffort | null,
    temperature: settings.temperature,
    requestTimeoutSec: settings.requestTimeoutSec,
  });
}
