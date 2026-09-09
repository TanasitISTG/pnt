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
          "Thai-target glossary priority: Within the same eight shared candidate slots, prioritize complete named combat techniques, named active or passive skills, named talents, cultivation or progression realm names, and coined system concepts that need stable rendering, including terms in brackets, notifications, and status panels. Keep characters, places, items, and other high-value names eligible and order all candidates by consistency value.",
          "Classify only a genuinely named technique, talent, or realm as a stable glossary candidate; ordinary labels such as skill, talent, level, rank, or attack are generic and should not be suggested. A coined but non-name story concept may be suggested only when it is recurring and clearly evidenced; review will keep it story_specific and pending under the existing policy.",
          "Do not suggest standalone F E D C B A S SS SSS entries or rank-letter-to-Thai-name mappings. A full named skill containing a rank label is eligible only when the complete term is independently named and evidenced.",
          "Use the complete source phrase and the target literally present in the bilingual evidence. Do not shorten a named term, invent a preferred target, or suggest a synonym or variant of an approved mapping.",
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
          "Thai-target glossary priority: Prioritize complete named combat techniques, named active or passive skills, named talents, cultivation or progression realm names, and coined system concepts that require stable terminology, including terms shown in brackets, notifications, and status panels. A genuinely named technique, talent, or realm is named_entity; a coined but non-name story concept is story_specific and remains pending under the existing policy; ordinary labels such as skill, talent, level, rank, or attack are generic and must be rejected.",
          "Do not suggest standalone F E D C B A S SS SSS entries or rank-letter-to-Thai-name mappings. A full named skill containing a rank label is eligible only on its own naming and literal-evidence merits.",
          "Require the complete source phrase and the target literally present in the bilingual evidence. Never shorten a named term, invent a preferred target, or create a synonym or variant of an approved mapping.",
        ]
      : []),
    ``,
    `APPROVE only a high-confidence named_entity when the source and target are both literally evidenced, the term is not a duplicate or variant of an existing approved term, and stable naming matters across the novel.`,
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
