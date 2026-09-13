import { z } from "zod";

import { LANG_LABELS, normalizePair } from "../prompts/language";
import type {
  GlossaryReviewAction,
  GlossaryReviewConfidence,
  GlossaryReviewResult,
  GlossaryReviewTermType,
  SuggestedTerm,
  TermSuggestionContext,
} from "../types/glossary";

export function buildTermSuggestionPrompt(
  languagePair: string,
  existingSources: string[],
  context?: TermSuggestionContext,
): string {
  const normalizedPair = normalizePair(languagePair);
  const targetLanguage = LANG_LABELS[normalizedPair].target;
  const existingList =
    existingSources.length > 0
      ? `Do NOT include any of the following terms which are already present in the glossary:\n${existingSources.slice(0, 100).join(", ")}`
      : "";

  const parts: string[] = [
    `You are a terminology extraction assistant specializing in literary translation (${languagePair}).`,
    `Analyze the source and translated chapter excerpts and identify only terms whose stable rendering materially improves consistency across the novel.`,
    `Eligible terms include character names, aliases, titles, named places or organizations, explicitly named skills, items, or systems, and coined story-specific concepts whose rendering must remain stable.`,
    `Do NOT suggest common nouns, verbs, or adjectives; generic roles or locations; everyday objects or food; broad school or business topics; actions or events; dates or numbers; public brands or people without a story-specific rendering; one-off descriptions; or substring fragments.`,
    `For each eligible term, extract its source text (original language), target translation (as used in the translated chapter), category ("character", "place", "skill", "item", or "other"), and an optional brief note written in ${targetLanguage}.`,
    `Prefer an empty array when nothing qualifies. Return at most 8 candidates, ordered by the value of preserving their translation consistently.`,
    ...(normalizedPair === "en->th" || normalizedPair === "zh->th"
      ? [
          "Thai-target glossary priority: Within the same eight shared candidate slots, prioritize stable setting terminology as well as proper names: occupations, classes, or professions; equipment, artifact, and item types; power or cultivation stages; grades, tiers, and rarity systems; materials, resources, currencies, attributes, and system/UI labels; complete named techniques, skills, and talents; and coined concepts used by the novel's rules or world-building.",
          "For Thai targets, judge a term by its function in this story, not by whether its words are common in isolation. The common-vocabulary exclusions above apply only to ordinary descriptive use. A common-looking role, object, color, level, or rank is eligible when the evidence defines or uses it as a stable domain concept or explicit taxonomy.",
          "An explicit definition, classification, or enumeration in the current chapter is sufficient evidence of glossary value; do not require multiple occurrences in the excerpt. For example, when a sentence defines an enhancer profession, its enhancement-device class, and a five-color equipment grading system, extract the profession and equipment class as glossary candidates rather than rejecting them as generic nouns.",
          "Do not emit isolated one-character color or grade labels, standalone F E D C B A S SS SSS entries, or rank-label-to-Thai-name mappings. Extract the smallest complete multi-character source phrase that carries the domain meaning, and use only the exact target phrase literally present in the bilingual evidence; never invent, shorten, or synonym-swap a mapping.",
        ]
      : []),
    existingList,
  ];

  if (context?.approvedMappings && context.approvedMappings.length > 0) {
    const mappingLines = context.approvedMappings
      .slice(0, 50)
      .map((m) => `${m.source} -> ${m.target}`);
    parts.push(
      `Approved glossary mappings (use these as reference for consistent naming):\n${mappingLines.join("\n")}`,
    );
  }

  parts.push(
    `CRITICAL: Return ONLY a JSON object with a single key "terms" containing an array of objects matching this exact structure:`,
    `{`,
    `  "terms": [`,
    `    { "source": "Original Term", "target": "Translated Term", "category": "character", "note": "Brief context" }`,
    `  ]`,
    `}`,
  );

  return parts.filter(Boolean).join("\n\n");
}

export function buildTermSuggestionUserMessage(
  translatedExcerpt: string,
  context?: TermSuggestionContext,
): string {
  const parts: string[] = [];

  if (context?.rawSourceExcerpt) {
    parts.push(`Source text excerpt:\n${context.rawSourceExcerpt.slice(0, 4000)}`);
  }

  parts.push(`Translated chapter excerpt:\n${translatedExcerpt.slice(0, 8000)}`);

  return parts.join("\n\n");
}

export function buildGlossaryReviewUserMessage(
  suggestions: SuggestedTerm[],
  rawSourceExcerpt: string,
  translatedExcerpt: string,
): string {
  return [
    "Review these suggested glossary terms:",
    JSON.stringify({ terms: suggestions }, null, 2),
    "",
    `Source text excerpt:\n${rawSourceExcerpt.slice(0, 4000)}`,
    "",
    `Translated chapter excerpt:\n${translatedExcerpt.slice(0, 8000)}`,
  ].join("\n");
}

const VALID_REVIEW_ACTIONS: Record<string, true> = {
  approve: true,
  reject: true,
  pending: true,
};
const VALID_REVIEW_CONFIDENCES: Record<string, true> = {
  high: true,
  medium: true,
  low: true,
};
const VALID_REVIEW_TERM_TYPES: Record<string, true> = {
  named_entity: true,
  story_specific: true,
  generic: true,
};

// LLM output is untrusted JSON — validate shape with zod before coercion.
const reviewItemSchema = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  termType: z.unknown().optional(),
  action: z.unknown().optional(),
  confidence: z.unknown().optional(),
  reason: z.unknown().optional(),
  matchingApprovedTerm: z.unknown().optional(),
});

const suggestionItemSchema = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  category: z.unknown().optional(),
  note: z.unknown().optional(),
});

export function buildGlossaryReviewPrompt(
  languagePair: string,
  approvedMappings: { source: string; target: string }[],
): string {
  const normalizedPair = normalizePair(languagePair);
  const mappingLines = approvedMappings.slice(0, 50).map((m) => `${m.source} -> ${m.target}`);

  return [
    `You are a glossary review assistant for literary translation (${languagePair}).`,
    `Review each suggested term against the supplied bilingual chapter evidence and classify its glossary value before choosing an action.`,
    `Eligible terms include character names, aliases, titles, named places or organizations, explicitly named skills, items, or systems, and coined story-specific concepts whose rendering must remain stable.`,
    `Common nouns, verbs, or adjectives; generic roles or locations; everyday objects or food; broad school or business topics; actions or events; dates or numbers; public brands or people without a story-specific rendering; one-off descriptions; and substring fragments are not glossary terms.`,
    ...(normalizedPair === "en->th" || normalizedPair === "zh->th"
      ? [
          "Thai-target glossary priority: Treat stable setting terminology as glossary material even when its words are common in isolation: occupations, classes, or professions; equipment, artifact, and item types; power or cultivation stages; grades, tiers, and rarity systems; materials, resources, currencies, attributes, and system/UI labels; complete named techniques, skills, and talents; and coined concepts used by the novel's rules or world-building.",
          "For Thai targets, the common-vocabulary exclusions above apply only to ordinary descriptive use. Classify a term as story_specific when the chapter defines or uses it as a stable domain concept or explicit taxonomy, even if the same word could be an ordinary role, object, color, level, or rank outside the story. An explicit definition, classification, or enumeration is sufficient; repetition within the excerpt is not required.",
          "When source and target phrases are exact and the domain role is unambiguous, emit termType \"story_specific\", action \"approve\", and confidence \"high\". Use action \"pending\" only when glossary eligibility and the literal mapping are clear but the term's lasting domain role still requires manual confirmation; reject ordinary descriptive uses as \"generic\".",
          "In an enhancer example with an enhancement-device class and five color grades, approve the profession and equipment class when literally evidenced; do not review isolated one-character color or grade labels, standalone F E D C B A S SS SSS entries, or rank-label-to-Thai-name mappings. Never shorten a source phrase, invent a preferred target, or create a synonym or variant of an approved mapping.",
        ]
      : []),
    ``,
    ...(normalizedPair === "en->th" || normalizedPair === "zh->th"
      ? [
          `APPROVE only a high-confidence named_entity or story_specific term when the source and target are both literally evidenced, the term is not a duplicate or variant of an existing approved term, and stable naming matters across the novel.`,
        ]
      : [
          `APPROVE only a high-confidence named_entity when the source and target are both literally evidenced, the term is not a duplicate or variant of an existing approved term, and stable naming matters across the novel.`,
        ]),
    `REJECT generic vocabulary, weak or unsupported candidates, duplicates, and terms without clear source or target evidence.`,
    `Use PENDING only for a high-confidence named_entity or story_specific term that may need manual confirmation. Uncertain ordinary vocabulary must be rejected, not sent to manual review.`,
    `Confidence measures confidence in both glossary eligibility and literal source/target evidence, not confidence in the chosen action alone.`,
    ``,
    `For every review, emit exactly one termType: "named_entity", "story_specific", or "generic". Generic terms must always be rejected.`,
    ``,
    `Existing approved glossary terms:\n${mappingLines.length > 0 ? mappingLines.join("\n") : "(none)"}`,
    ``,
    `CRITICAL: Return ONLY a JSON object with a single key "reviews" containing an array:`,
    `{`,
    `  "reviews": [`,
    `    {`,
    `      "source": "Original Term",`,
    `      "target": "Translated Term",`,
    `      "termType": "named_entity" | "story_specific" | "generic",`,
    `      "action": "approve" | "reject" | "pending",`,
    `      "confidence": "high" | "medium" | "low",`,
    `      "reason": "Brief explanation",`,
    `      "matchingApprovedTerm": "If rejecting as duplicate, the existing term source"`,
    `    }`,
    `  ]`,
    `}`,
  ].join("\n");
}

export function parseGlossaryReviewResponse(rawContent: string): GlossaryReviewResult[] | null {
  if (!rawContent || !rawContent.trim()) return null;

  let jsonString = rawContent.trim();
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  try {
    const parsed: unknown = JSON.parse(jsonString);
    const container =
      parsed && typeof parsed === "object" ? (parsed as { reviews?: unknown }) : null;
    const rawArray: unknown[] | null = Array.isArray(parsed)
      ? parsed
      : Array.isArray(container?.reviews)
        ? container.reviews
        : null;
    if (rawArray === null) return null;

    return rawArray.flatMap((item) => {
      const r = reviewItemSchema.safeParse(item);
      if (!r.success) return [];
      const termType = Object.hasOwn(VALID_REVIEW_TERM_TYPES, String(r.data.termType))
        ? (String(r.data.termType) as GlossaryReviewTermType)
        : "generic";
      const action = Object.hasOwn(VALID_REVIEW_ACTIONS, String(r.data.action))
        ? (String(r.data.action) as GlossaryReviewAction)
        : "pending";
      const confidence = Object.hasOwn(VALID_REVIEW_CONFIDENCES, String(r.data.confidence))
        ? (String(r.data.confidence) as GlossaryReviewConfidence)
        : "low";

      return [
        {
          source: r.data.source,
          target: r.data.target,
          termType,
          action,
          confidence,
          reason: typeof r.data.reason === "string" ? r.data.reason.trim() : "",
          matchingApprovedTerm:
            typeof r.data.matchingApprovedTerm === "string" &&
            r.data.matchingApprovedTerm.trim().length > 0
              ? r.data.matchingApprovedTerm.trim()
              : undefined,
        },
      ];
    });
  } catch {
    return null;
  }
}

export function parseTermSuggestions(rawContent: string): SuggestedTerm[] | null {
  if (!rawContent || !rawContent.trim()) return null;

  let jsonString = rawContent.trim();

  // Extract JSON from markdown block if present
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  try {
    const parsed: unknown = JSON.parse(jsonString);
    const container = parsed && typeof parsed === "object" ? (parsed as { terms?: unknown }) : null;
    const rawArray: unknown[] | null = Array.isArray(parsed)
      ? parsed
      : Array.isArray(container?.terms)
        ? container.terms
        : null;
    if (rawArray === null) return null;

    const validCategories: Record<string, true> = {
      character: true,
      place: true,
      skill: true,
      item: true,
      other: true,
    };

    const suggestions = rawArray.flatMap((item) => {
      const r = suggestionItemSchema.safeParse(item);
      if (!r.success) return [];
      const category = Object.hasOwn(validCategories, String(r.data.category).toLowerCase())
        ? (String(r.data.category).toLowerCase() as SuggestedTerm["category"])
        : "other";
      return [
        {
          source: r.data.source,
          target: r.data.target,
          category,
          note: typeof r.data.note === "string" ? r.data.note.trim() : undefined,
        },
      ];
    });
    return rawArray.length > 0 && suggestions.length === 0 ? null : suggestions;
  } catch {
    return null;
  }
}
