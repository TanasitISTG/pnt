import type { GlossaryReviewResult, SuggestedTerm } from "./translation.types";

export const MAX_GLOSSARY_SUGGESTIONS_PER_CHAPTER = 8;

export interface GlossarySuggestionPolicyInput {
  suggestions: SuggestedTerm[];
  reviews: GlossaryReviewResult[];
  fullRawSource: string;
  fullTranslation: string;
  existingSources: string[];
}

export interface AcceptedGlossarySuggestion extends SuggestedTerm {
  status: "approved" | "pending";
}

export interface GlossarySuggestionPolicyResult {
  accepted: AcceptedGlossarySuggestion[];
  discardedCount: number;
  conflictCount: number;
}

export interface PreparedGlossarySuggestions {
  candidates: SuggestedTerm[];
  discardedCount: number;
  conflictCount: number;
}

export function normalizeGlossaryComparisonKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function prepareGlossarySuggestionCandidates(
  suggestions: SuggestedTerm[],
  existingSources: string[],
): PreparedGlossarySuggestions {
  let discardedCount = 0;
  let conflictCount = 0;
  const existingSourceKeys = new Set(
    existingSources.map((source) => normalizeGlossaryComparisonKey(source)),
  );
  const seenSuggestionSources = new Set<string>();
  const uniqueSuggestions: SuggestedTerm[] = [];

  for (const suggestion of suggestions) {
    const sourceKey = normalizeGlossaryComparisonKey(suggestion.source);
    if (seenSuggestionSources.has(sourceKey)) {
      discardedCount++;
      continue;
    }
    seenSuggestionSources.add(sourceKey);

    if (sourceKey.length === 0 || Array.from(sourceKey).length < 2) {
      discardedCount++;
      continue;
    }

    if (existingSourceKeys.has(sourceKey)) {
      conflictCount++;
      continue;
    }

    uniqueSuggestions.push(suggestion);
  }

  if (uniqueSuggestions.length > MAX_GLOSSARY_SUGGESTIONS_PER_CHAPTER) {
    discardedCount += uniqueSuggestions.length - MAX_GLOSSARY_SUGGESTIONS_PER_CHAPTER;
  }

  return {
    candidates: uniqueSuggestions.slice(0, MAX_GLOSSARY_SUGGESTIONS_PER_CHAPTER),
    discardedCount,
    conflictCount,
  };
}

export function applyGlossarySuggestionPolicy({
  suggestions,
  reviews,
  fullRawSource,
  fullTranslation,
  existingSources,
}: GlossarySuggestionPolicyInput): GlossarySuggestionPolicyResult {
  const prepared = prepareGlossarySuggestionCandidates(suggestions, existingSources);
  let { discardedCount } = prepared;
  const { candidates, conflictCount } = prepared;

  const reviewBySource = new Map<string, GlossaryReviewResult>();
  for (const review of reviews) {
    const sourceKey = normalizeGlossaryComparisonKey(review.source);
    if (!reviewBySource.has(sourceKey)) {
      reviewBySource.set(sourceKey, review);
    }
  }

  const accepted: AcceptedGlossarySuggestion[] = [];
  for (const suggestion of candidates) {
    const source = suggestion.source.trim();
    const sourceKey = normalizeGlossaryComparisonKey(source);
    const review = reviewBySource.get(sourceKey);
    const target = review?.target.trim() ?? "";
    const targetKey = normalizeGlossaryComparisonKey(target);

    if (
      targetKey.length === 0 ||
      sourceKey === targetKey ||
      !fullRawSource.includes(source) ||
      !fullTranslation.includes(target) ||
      !review ||
      review.termType === "generic" ||
      review.action === "reject" ||
      review.confidence !== "high"
    ) {
      discardedCount++;
      continue;
    }

    const status =
      review.termType === "named_entity" && review.action === "approve"
        ? "approved"
        : review.termType === "story_specific" &&
            (review.action === "approve" || review.action === "pending")
          ? "pending"
          : review.termType === "named_entity" && review.action === "pending"
            ? "pending"
            : null;

    if (!status) {
      discardedCount++;
      continue;
    }

    accepted.push({
      ...suggestion,
      source,
      target,
      status,
    });
  }

  return { accepted, discardedCount, conflictCount };
}

export function selectRelevantApprovedMappings(
  suggestions: Pick<SuggestedTerm, "source" | "target">[],
  approvedTerms: { source: string; target: string }[],
  limit = 50,
): { source: string; target: string }[] {
  if (limit <= 0 || suggestions.length === 0 || approvedTerms.length === 0) return [];

  const candidateSources = suggestions
    .map((suggestion) => normalizeGlossaryComparisonKey(suggestion.source))
    .filter((source) => source.length > 0);
  const candidateTargets = new Set(
    suggestions
      .map((suggestion) => normalizeGlossaryComparisonKey(suggestion.target))
      .filter((target) => target.length > 0),
  );
  const relevantMappings: Array<{
    source: string;
    target: string;
    sourceKey: string;
    targetKey: string;
  }> = [];

  for (const approvedTerm of approvedTerms) {
    const sourceKey = normalizeGlossaryComparisonKey(approvedTerm.source);
    const targetKey = normalizeGlossaryComparisonKey(approvedTerm.target);
    if (sourceKey.length === 0 || targetKey.length === 0) continue;

    const sourceMatches = candidateSources.some(
      (candidateSource) =>
        sourceKey.includes(candidateSource) || candidateSource.includes(sourceKey),
    );
    if (!sourceMatches && !candidateTargets.has(targetKey)) continue;

    relevantMappings.push({ ...approvedTerm, sourceKey, targetKey });
  }

  relevantMappings.sort((left, right) => {
    if (left.sourceKey !== right.sourceKey) return left.sourceKey < right.sourceKey ? -1 : 1;
    if (left.targetKey !== right.targetKey) return left.targetKey < right.targetKey ? -1 : 1;
    if (left.source !== right.source) return left.source < right.source ? -1 : 1;
    if (left.target !== right.target) return left.target < right.target ? -1 : 1;
    return 0;
  });

  const selectedKeys = new Set<string>();
  const selected: { source: string; target: string }[] = [];
  for (const mapping of relevantMappings) {
    const mappingKey = `${mapping.sourceKey}\u0000${mapping.targetKey}`;
    if (selectedKeys.has(mappingKey)) continue;
    selectedKeys.add(mappingKey);
    selected.push({ source: mapping.source, target: mapping.target });
    if (selected.length >= limit) break;
  }

  return selected;
}
