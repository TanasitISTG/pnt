import "@tanstack/react-start/server-only";

import type { ProviderClientConfig } from "./provider-client";
import { buildTitlePrompt } from "./prompts";

/**
 * Translates a single chapter title. Returns null on any failure or empty
 * output — callers treat null as "keep the raw title".
 */
export async function translateChapterTitle(
  providerConfig: ProviderClientConfig,
  pair: string,
  title: string,
): Promise<string | null> {
  try {
    const completion = await providerConfig.client.chat.completions.create({
      model: providerConfig.model,
      temperature: 0.3,
      messages: [
        { role: "system", content: buildTitlePrompt(pair) },
        { role: "user", content: title },
      ],
    });
    const translated = completion.choices[0]?.message?.content?.trim();
    return translated || null;
  } catch {
    return null;
  }
}
