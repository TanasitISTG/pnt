import "@tanstack/react-start/server-only";

import type { GlossaryTermInput } from "../types/glossary";
import type { ProviderClientConfig } from "../types/provider";
import { buildRelationshipPromptContextForText } from "@/lib/relationships/map";
import type { RelationshipMapV1 } from "@/lib/relationships/schemas";
import { filterGlossaryForChunk, formatGlossaryBlock } from "../glossary/terms";
import { buildTitlePrompt } from "../prompts/translation";
import { retryTranslationOperation } from "./retry";

export interface TitleTranslationOptions {
  glossaryTerms?: GlossaryTermInput[];
  customPrompt?: string | null;
  relationshipMap?: RelationshipMapV1 | null;
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
  const relationshipContext = buildRelationshipPromptContextForText(
    options?.relationshipMap ?? null,
    title,
  );
  const titlePrompt = buildTitlePrompt(pair, {
    glossaryBlock,
    relationshipContext,
    customPrompt: options?.customPrompt,
  });

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
