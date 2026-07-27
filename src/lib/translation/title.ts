import "@tanstack/react-start/server-only";

import type { ProviderClientConfig } from "./provider-client";
import { buildTitlePrompt } from "./prompts";

/**
 * Translates a single chapter title. Returns { translated, promptTokens, completionTokens },
 * where translated is null on any failure or empty output.
 */
export async function translateChapterTitle(
  providerConfig: ProviderClientConfig,
  pair: string,
  title: string,
): Promise<{ translated: string | null; promptTokens: number; completionTokens: number }> {
  try {
    const completion = await providerConfig.generateChatCompletion({
      temperature: 0.3,
      model: providerConfig.fastModel ?? undefined,
      messages: [
        { role: "system", content: buildTitlePrompt(pair) },
        { role: "user", content: title },
      ],
    });
    const promptTokens = completion.usage?.promptTokens || 0;
    const completionTokens = completion.usage?.completionTokens || 0;
    const translated = completion.content.trim() || null;
    return { translated, promptTokens, completionTokens };
  } catch {
    return { translated: null, promptTokens: 0, completionTokens: 0 };
  }
}
