import { z } from "zod";

import { LANG_LABELS, normalizePair } from "./prompts";
import type {
  GlossaryReviewAction,
  GlossaryReviewConfidence,
  GlossaryReviewResult,
  SuggestedTerm,
  TermSuggestionContext,
} from "./translation.types";

export function buildTermSuggestionPrompt(
  languagePair: string,
  existingSources: string[],
  context?: TermSuggestionContext,
): string {
  const existingList =
    existingSources.length > 0
      ? `Do NOT include any of the following terms which are already present in the glossary:\n${existingSources.slice(0, 100).join(", ")}`
      : "";

  const parts: string[] = [
    `You are a terminology extraction assistant specializing in literary translation (${languagePair}).`,
    `Analyze the provided translated chapter text and identify key terms: character names, place names, special skills, items, and other recurring novel concepts.`,
    `For each term, extract its source text (original language), target translation (as used in the translated chapter), category ("character", "place", "skill", "item", or "other"), and an optional brief note written in ${LANG_LABELS[normalizePair(languagePair)].target}.`,
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

  if (context?.chapterSummary) {
    parts.push(`Chapter summary:\n${context.chapterSummary.slice(0, 2000)}`);
  }

  return parts.join("\n\n");
}

const VALID_REVIEW_ACTIONS = new Set(["approve", "reject", "pending"]);
const VALID_REVIEW_CONFIDENCES = new Set(["high", "medium", "low"]);

// LLM output is untrusted JSON — validate shape with zod before coercion.
const reviewItemSchema = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
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
  const mappingLines = approvedMappings.slice(0, 50).map((m) => `${m.source} -> ${m.target}`);

  return [
    `You are a glossary review assistant for literary translation (${languagePair}).`,
    `You will receive a list of suggested glossary terms extracted from a newly translated chapter.`,
    `For each term, decide whether to APPROVE, REJECT, or leave it PENDING.`,
    ``,
    `APPROVE only when ALL of these are true:`,
    `- The term has clear source-language evidence (the original term is present in the source text).`,
    `- The term has clear target-language evidence (the translation uses a consistent target form).`,
    `- The term is not a duplicate or variant of an existing approved term.`,
    `- The term represents a real recurring concept (character, place, skill, item).`,
    ``,
    `REJECT when:`,
    `- The term is a duplicate or case/spacing variant of an existing approved term.`,
    `- The source or target is empty, generic, or not a real named entity.`,
    `- The term is clearly not a recurring concept.`,
    ``,
    `Leave PENDING when uncertain — manual review is preferred over wrong automation.`,
    ``,
    `Existing approved glossary terms:\n${mappingLines.length > 0 ? mappingLines.join("\n") : "(none)"}`,
    ``,
    `CRITICAL: Return ONLY a JSON object with a single key "reviews" containing an array:`,
    `{`,
    `  "reviews": [`,
    `    {`,
    `      "source": "Original Term",`,
    `      "target": "Translated Term",`,
    `      "action": "approve" | "reject" | "pending",`,
    `      "confidence": "high" | "medium" | "low",`,
    `      "reason": "Brief explanation",`,
    `      "matchingApprovedTerm": "If rejecting as duplicate, the existing term source"`,
    `    }`,
    `  ]`,
    `}`,
  ].join("\n");
}

export function parseGlossaryReviewResponse(rawContent: string): GlossaryReviewResult[] {
  if (!rawContent || !rawContent.trim()) return [];

  let jsonString = rawContent.trim();
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  try {
    const parsed: unknown = JSON.parse(jsonString);
    const container = parsed as { reviews?: unknown };
    const rawArray: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(container?.reviews)
        ? container.reviews
        : [];

    return rawArray.flatMap((item) => {
      const r = reviewItemSchema.safeParse(item);
      if (!r.success) return [];
      const action = VALID_REVIEW_ACTIONS.has(String(r.data.action))
        ? (String(r.data.action) as GlossaryReviewAction)
        : "pending";
      const confidence = VALID_REVIEW_CONFIDENCES.has(String(r.data.confidence))
        ? (String(r.data.confidence) as GlossaryReviewConfidence)
        : "low";

      return [
        {
          source: r.data.source,
          target: r.data.target,
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
    return [];
  }
}

export function parseTermSuggestions(rawContent: string): SuggestedTerm[] {
  if (!rawContent || !rawContent.trim()) return [];

  let jsonString = rawContent.trim();

  // Extract JSON from markdown block if present
  const codeBlockMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    jsonString = codeBlockMatch[1].trim();
  }

  try {
    const parsed: unknown = JSON.parse(jsonString);
    const container = parsed as { terms?: unknown };
    const rawArray: unknown[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(container?.terms)
        ? container.terms
        : [];

    const validCategories = new Set(["character", "place", "skill", "item", "other"]);

    return rawArray.flatMap((item) => {
      const r = suggestionItemSchema.safeParse(item);
      if (!r.success) return [];
      const category = validCategories.has(String(r.data.category).toLowerCase())
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
  } catch {
    return [];
  }
}
