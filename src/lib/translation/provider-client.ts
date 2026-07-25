import "@tanstack/react-start/server-only";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { providerSettings } from "@/lib/db/schema";
import { decrypt } from "@/lib/translation/crypto";

export class ProviderNotConfiguredError extends Error {
  constructor(message = "AI provider settings are not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export type ProviderType = "openai" | "gemini";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  model?: string;
  responseFormat?: { type: "json_object" | "text" };
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface AIProviderClient {
  provider: ProviderType;
  model: string;
  temperature: number;
  baseUrl: string;
  generateChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export class OpenAIProviderClient implements AIProviderClient {
  provider: ProviderType = "openai";
  model: string;
  temperature: number;
  baseUrl: string;
  private client: OpenAI;

  constructor(config: { apiKey: string; baseUrl: string; model: string; temperature: number }) {
    this.model = config.model;
    this.temperature = config.temperature;
    this.baseUrl = config.baseUrl;
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      timeout: 4 * 60_000,
      maxRetries: 0,
    });
  }

  async generateChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const completion = await this.client.chat.completions.create({
      model: options.model ?? this.model,
      temperature: options.temperature ?? this.temperature,
      max_tokens: options.maxTokens,
      messages: options.messages,
      response_format: options.responseFormat,
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
  temperature: number;
  baseUrl: string;
  private ai: GoogleGenAI;

  constructor(config: { apiKey: string; baseUrl?: string; model: string; temperature: number }) {
    this.model = config.model;
    this.temperature = config.temperature;
    this.baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com";
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl && config.baseUrl !== "https://generativelanguage.googleapis.com"
        ? { httpOptions: { baseUrl: config.baseUrl } }
        : {}),
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

export type ProviderClientConfig = AIProviderClient;

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
      temperature: settings.temperature,
    });
  }

  return new OpenAIProviderClient({
    apiKey,
    baseUrl: settings.baseUrl,
    model: settings.model,
    temperature: settings.temperature,
  });
}
