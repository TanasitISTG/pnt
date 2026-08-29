import "@tanstack/react-start/server-only";

import type { GlossaryTermInput, ProviderClientConfig } from "./translation.types";
import { filterGlossaryForChunk, formatGlossaryBlock } from "./glossary";
import { buildTitlePrompt } from "./prompts";
import { retryTranslationOperation } from "./retry";

export interface TitleTranslationOptions {
  glossaryTerms?: GlossaryTermInput[];
  customPrompt?: string | null;
}

/**
 * Translates a single chapter title. Returns { translated, promptTokens, completionTokens },
 * where translated is null on any failure or empty output.
 */
export async function translateChapterTitle(
  providerConfig: ProviderClientConfig,
  pair: string,
  title: string,
  options?: TitleTranslationOptions,
): Promise<{ translated: string | null; promptTokens: number; completionTokens: number }> {
  let promptTokens = 0;
  let completionTokens = 0;
  const glossaryBlock = formatGlossaryBlock(
    filterGlossaryForChunk(options?.glossaryTerms ?? [], title),
  );
  const titlePrompt = buildTitlePrompt(pair, glossaryBlock, options?.customPrompt);

  try {
    const translated = await retryTranslationOperation(async () => {
      const completion = await providerConfig.generateChatCompletion({
        temperature: 0.3,
        model: providerConfig.fastModel ?? undefined,
        messages: [
          { role: "system", content: titlePrompt },
          { role: "user", content: title },
        ],
      });
      promptTokens += completion.usage?.promptTokens || 0;
      completionTokens += completion.usage?.completionTokens || 0;

      const content = completion.content?.trim() || "";
      if (!content) throw new Error("Empty title completion");
      return content;
    });
    return { translated, promptTokens, completionTokens };
  } catch {
    return { translated: null, promptTokens, completionTokens };
  }
}
