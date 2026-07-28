import type { ContextOptions, LanguagePair } from "./translation.types";

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  pair: string,
  glossaryBlock?: string | null,
  context?: ContextOptions | null,
  customPrompt?: string | null,
): string {
  const p = normalizePair(pair);

  const sections: string[] = [
    getRoleLine(p),
    getPriorityOrder(),
    getHardRules(),
    getStyleGuidelines(p),
    getFewShotExample(p),
  ];

  if (glossaryBlock && glossaryBlock.trim().length > 0) {
    sections.push(
      `## Terminology & Glossary\nThe glossary below is authoritative.\nALWAYS use the exact glossary translation — including spacing, punctuation, and capitalization — every time the source term appears.\nNever invent alternative spellings or wordings for glossary entries.\n${glossaryBlock.trim()}`,
    );
  }

  if (context?.previousSummary && context.previousSummary.trim().length > 0) {
    sections.push(
      `## Story Context\n### Summary of Previous Chapter:\n${context.previousSummary.trim()}`,
    );
  }

  if (customPrompt && customPrompt.trim().length > 0) {
    sections.push(`## Custom Instructions\n${customPrompt.trim()}`);
  }

  sections.push(getOutputContract());

  return sections.join("\n\n");
}

/**
 * Builds the user message with optional preceding-translation context and
 * <<<BEGIN_TEXT>>> / <<<END_TEXT>>> delimiters around the translatable chunk.
 */
export function buildUserMessage(markedText: string, previousChunkTail?: string | null): string {
  const parts: string[] = [];

  if (previousChunkTail && previousChunkTail.trim().length > 0) {
    parts.push(
      `[Preceding translation for continuity — do not translate this]\n...${previousChunkTail.trim()}`,
    );
  }

  parts.push(`<<<BEGIN_TEXT>>>\n${markedText}\n<<<END_TEXT>>>`);

  return parts.join("\n\n");
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
    "Provide a concise summary (~150-250 words) of the chapter.",
    "CRITICAL REQUIREMENT: Always write the summary in ENGLISH, regardless of the source or target language of the novel.",
    "",
    "Structure your summary with these sections:",
    "PLOT: Key events and developments (2-3 sentences).",
    "CHARACTERS: Named characters active in this chapter, their current state, and relationships shown.",
    "SETTING: Current location(s) and any setting changes.",
    "CONTEXT: Key facts, unresolved tensions, or foreshadowing that would help translate the next chapter.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Residual source-script detection
// ---------------------------------------------------------------------------

// CJK ideographs (ext-A + unified + compat). Leftover hanzi in output = missed translation.
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;

/** Leftover CJK chars in a translation — never legitimate output, so detection is pair-agnostic
 *  (a wrong sourceLang on the novel must not disable it). `pair` kept for caller compatibility. */
export function findResidualSourceChars(_pair: string, text: string): string[] {
  return text.match(CJK_RE) || [];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export function normalizePair(pair: string): LanguagePair {
  const clean = pair.toLowerCase().replace(/\s+/g, "").replace("→", "->");
  if (clean === "en->th" || clean === "enth") return "en->th";
  if (clean === "zh->en" || clean === "zhen") return "zh->en";
  if (clean === "zh->th" || clean === "zhth") return "zh->th";
  return "en->th";
}

export const LANG_LABELS: Record<LanguagePair, { source: string; target: string }> = {
  "en->th": { source: "English", target: "Thai" },
  "zh->en": { source: "Chinese", target: "English" },
  "zh->th": { source: "Chinese", target: "Thai" },
};

function getRoleLine(pair: LanguagePair): string {
  const { source, target } = LANG_LABELS[pair];
  return `You translate ${source} web novels into ${target}.`;
}

function getPriorityOrder(): string {
  return [
    "## Translation Priorities (highest first)",
    "1. Glossary accuracy — use exact glossary translations",
    "2. Completeness — translate every word, line, and element",
    "3. Meaning fidelity — convey the author's intent accurately",
    "4. Natural target language — restructure for natural target-language syntax",
    "5. Style preservation — maintain tone, pacing, and voice",
  ].join("\n");
}

function getHardRules(): string {
  return [
    "## Hard Rules",
    "- Translate everything: narration, dialogue, system messages, internal thoughts, status windows, sound effects, bracketed text (【】[]), notifications, names, and usernames. Transliterate names into the target script. No source-language text may remain.",
    "- Do not add information absent from the source. Do not explain terms. Do not infer omitted context.",
    "- Do not rewrite for literary improvement. Preserve pacing, repetition, and stylistic quirks when intentional.",
    "- Do not summarize or skip content.",
    "- If HTML/XML-like tags appear in the source, preserve them verbatim. Translate only visible text content.",
    "- Preserve every ||¶|| paragraph marker exactly as-is in your translation output, in the same position relative to the surrounding paragraphs. Do not add, remove, or reorder markers.",
  ].join("\n");
}

function getStyleGuidelines(pair: LanguagePair): string {
  const { target } = LANG_LABELS[pair];
  const lines = [
    "## Style Guidelines",
    `- Translate the meaning of each sentence. Restructure for natural ${target} syntax — do not mirror source sentence structure.`,
    "- When the source is intentionally ambiguous, preserve the ambiguity. Do not resolve uncertain pronouns unless the original does.",
    "- Render every ellipsis or hesitation pause as a single `…`. Never output runs of dots or middle dots (`......`, `······`, `……`).",
    "- For names not in the glossary, transliterate consistently. If a proper noun appears multiple times, use the same translation every time.",
  ];

  if (pair === "en->th" || pair === "zh->th") {
    lines.push(
      "- Thai punctuation and quotes: use curly double quotes (“…”), and do not leave space before `…`.",
      "- Dialogue should sound as if originally written in Thai. Each character must have a consistent speech level, vocabulary, pronoun choice, and honorific usage. Do not make different characters sound alike.",
      "- Keep each named character's Thai pronoun and speech level consistent with the Story Context and preceding translation.",
    );
  }

  if (pair === "zh->en") {
    lines.push(
      "- Properly localize cultivation ranks, techniques, and honorific idioms while preserving the genre's distinct atmosphere.",
    );
  }

  return lines.join("\n");
}

function getFewShotExample(pair: LanguagePair): string {
  const examples: Record<LanguagePair, { source: string; translation: string }> = {
    "en->th": {
      source: `"I told you to stay away," he said coldly, turning his back to her. She clenched her fists but said nothing.`,
      translation: `“บอกแล้วไงว่าอย่าเข้ามาใกล้” เขาพูดเสียงเย็นชาพลางหันหลังให้เธอ เธอกำหมัดแน่นแต่ไม่ได้เอ่ยอะไร`,
    },
    "zh->en": {
      source: `"你以为你是谁？"他冷笑道。身后的少女瑟瑟发抖，却一言不发。`,
      translation: `"Who do you think you are?" he sneered. Behind him, the girl trembled yet said nothing.`,
    },
    "zh->th": {
      source: `"你以为你是谁……"他冷笑道。身后的少女瑟瑟发抖，却一言不发。`,
      translation: `“แกคิดว่าแกเป็นใคร…” เขายิ้มเยาะ สาวน้อยด้านหลังตัวสั่นแต่ไม่เอ่ยสักคำ`,
    },
  };

  const ex = examples[pair];
  return ["## Example", `Source: ${ex.source}`, `Good translation: ${ex.translation}`].join("\n");
}

function getOutputContract(): string {
  return [
    "## Output Requirements",
    "- Translate ONLY the text between the <<<BEGIN_TEXT>>> and <<<END_TEXT>>> markers.",
    "- Output only the translated text.",
    "- Do not wrap output in Markdown code fences.",
    "- Do not include explanations, notes, or commentary.",
    "- This text is a segment of a longer chapter. It may begin or end mid-sentence. Translate it completely without adding introductory or concluding remarks.",
  ].join("\n");
}
