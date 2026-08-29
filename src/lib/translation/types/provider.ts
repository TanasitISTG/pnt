export type ProviderType = "openai" | "gemini";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

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
  fastModel?: string | null;
  temperature: number;
  baseUrl: string;
  generateChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}

export type ProviderClientConfig = AIProviderClient;
