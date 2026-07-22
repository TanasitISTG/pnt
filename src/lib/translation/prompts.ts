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
      `## Terminology & Glossary\nUse the following official translations for names, terms, and places. You MUST use the exact target wording shown — including spacing, punctuation, and capitalization — every time the source term appears:\n${glossaryBlock.trim()}`,
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

  sections.push(
    `## Paragraph Formatting\nThe text contains paragraph-break markers in the form: ||¶||\nYou MUST preserve every ||¶|| marker exactly as-is in your translation output, in the same position relative to the surrounding paragraphs. Do not add, remove, or reorder markers. Do not replace them with blank lines or any other separator. Output only the translation.`,
  );

  if (customPrompt && customPrompt.trim().length > 0) {
    sections.push(`## Custom Instructions\n${customPrompt.trim()}`);
  }

  return sections.join("\n\n");
}

export function buildTitlePrompt(pair: string): string {
  const normalizedPair = normalizePair(pair);
  const langs: Record<LanguagePair, string> = {
    "en->th": "English to Thai",
    "zh->en": "Chinese to English",
    "zh->th": "Chinese to Thai",
  };
  return [
    `You are a professional literary translator. Translate the chapter title from ${langs[normalizedPair]}.`,
    "Output ONLY the translated title — no quotes, no explanation, no chapter numbers.",
  ].join("\n");
}

export function buildSummaryPrompt(_pair: string): string {
  return [
    "You are an expert novel editor and summarizer.",
    "Provide a concise summary (~150-250 words) of the key plot developments, character movements, and important reveals in the chapter.",
    "CRITICAL REQUIREMENT: Always write the summary in ENGLISH, regardless of the source or target language of the novel.",
    "Focus on key facts and names that will serve as context for translating subsequent chapters.",
  ].join(" ");
}

// Fast models treat 【...】 gift/system lines and Chinese usernames as markup to
// preserve verbatim — the rule below has to be explicit.
const COMPLETENESS_RULE =
  "Translate everything, including text inside brackets (【】[]), system/gift/notification lines, and all names and usernames — transliterate names into the target script. No source-language text may remain in the output.";

// CJK ideographs (ext-A + unified + compat). Leftover hanzi in zh output = missed translation.
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;

/** Leftover source-script chars in a translation. zh pairs only — latin-in-Thai is too common to flag. */
export function findResidualSourceChars(pair: string, text: string): string[] {
  if (normalizePair(pair) === "en->th") return [];
  return text.match(CJK_RE) || [];
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
        COMPLETENESS_RULE,
      ].join("\n");
    case "zh->en":
      return [
        "You are a professional literary translator specializing in Chinese (xianxia/xuanhuan/web novel) to English translations.",
        "Translate the following Chinese web novel excerpt into vivid, fluent, natural English.",
        "Properly localize cultivation ranks, techniques, and honorific idioms while preserving the genre's distinct atmosphere.",
        "Do not summarize or skip content. Translate accurately paragraph by paragraph.",
        COMPLETENESS_RULE,
      ].join("\n");
    case "zh->th":
      return [
        "You are a professional literary translator specializing in Chinese web novel to Thai translations.",
        "Translate the following Chinese web novel excerpt into expressive, natural Thai tailored for novel readers.",
        "Maintain appropriate Thai honorifics and prose style suited for Chinese fantasy/romance web novels.",
        "Do not summarize or skip content. Translate accurately paragraph by paragraph.",
        COMPLETENESS_RULE,
      ].join("\n");
  }
}
