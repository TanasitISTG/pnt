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
    const completion = await providerConfig.client.chat.completions.create({
      model: providerConfig.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: buildTitlePrompt(pair) },
        { role: "user", content: title },
      ],
    });
    const promptTokens = completion.usage?.prompt_tokens || 0;
    const completionTokens = completion.usage?.completion_tokens || 0;
    const translated = completion.choices[0]?.message?.content?.trim() || null;
    return { translated, promptTokens, completionTokens };
  } catch {
    return { translated: null, promptTokens: 0, completionTokens: 0 };
  }
}
