export type LanguagePair = "en->th" | "zh->en" | "zh->th";

export interface ContextOptions {
  previousSummary?: string | null;
  previousChunkTail?: string | null;
}

export function buildSystemPrompt(
  pair: string,
  glossaryBlock?: string | null,
  context?: ContextOptions | null,
  customPrompt?: string | null,
): string {
  const normalizedPair = normalizePair(pair);
  const baseInstruction = getBaseInstruction(normalizedPair);

  const sections: string[] = [baseInstruction];

  if (glossaryBlock && glossaryBlock.trim().length > 0) {
    sections.push(
      `## Terminology & Glossary\nUse the following official translations for names, terms, and places:\n${glossaryBlock.trim()}`,
    );
  }

  if (context) {
    const contextParts: string[] = [];
    if (context.previousSummary && context.previousSummary.trim().length > 0) {
      contextParts.push(`### Summary of Previous Chapter:\n${context.previousSummary.trim()}`);
    }
    if (context.previousChunkTail && context.previousChunkTail.trim().length > 0) {
      contextParts.push(
        `### Translation of Preceding Text:\n...${context.previousChunkTail.trim()}`,
      );
    }
    if (contextParts.length > 0) {
      sections.push(`## Story Context\n${contextParts.join("\n\n")}`);
    }
  }

  if (customPrompt && customPrompt.trim().length > 0) {
    sections.push(`## Custom Instructions\n${customPrompt.trim()}`);
  }

  return sections.join("\n\n");
}

export function buildSummaryPrompt(_pair: string): string {
  return [
    "You are an expert novel editor and summarizer.",
    "Provide a concise summary (~150-250 words) of the key plot developments, character movements, and important reveals in the chapter.",
    "CRITICAL REQUIREMENT: Always write the summary in ENGLISH, regardless of the source or target language of the novel.",
    "Focus on key facts and names that will serve as context for translating subsequent chapters.",
  ].join(" ");
}

function normalizePair(pair: string): LanguagePair {
  const clean = pair.toLowerCase().replace(/\s+/g, "").replace("→", "->");
  if (clean === "en->th" || clean === "enth") return "en->th";
  if (clean === "zh->en" || clean === "zhen") return "zh->en";
  if (clean === "zh->th" || clean === "zhth") return "zh->th";
  return "en->th";
}

function getBaseInstruction(pair: LanguagePair): string {
  switch (pair) {
    case "en->th":
      return [
        "You are a professional literary translator specializing in English to Thai novel translations.",
        "Translate the following English web novel excerpt into fluent, expressive, natural Thai appropriate for web novels.",
        "Maintain character voices, tone, emotional nuance, and honorific forms.",
        "Do not summarize or skip content. Translate accurately paragraph by paragraph.",
      ].join("\n");
    case "zh->en":
      return [
        "You are a professional literary translator specializing in Chinese (xianxia/xuanhuan/web novel) to English translations.",
        "Translate the following Chinese web novel excerpt into vivid, fluent, natural English.",
        "Properly localize cultivation ranks, techniques, and honorific idioms while preserving the genre's distinct atmosphere.",
        "Do not summarize or skip content. Translate accurately paragraph by paragraph.",
      ].join("\n");
    case "zh->th":
      return [
        "You are a professional literary translator specializing in Chinese web novel to Thai translations.",
        "Translate the following Chinese web novel excerpt into expressive, natural Thai tailored for novel readers.",
        "Maintain appropriate Thai honorifics and prose style suited for Chinese fantasy/romance web novels.",
        "Do not summarize or skip content. Translate accurately paragraph by paragraph.",
      ].join("\n");
  }
}
