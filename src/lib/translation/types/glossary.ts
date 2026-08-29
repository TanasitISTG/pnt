export interface SuggestedTerm {
  source: string;
  target: string;
  category: "character" | "place" | "skill" | "item" | "other";
  note?: string;
}

export type GlossaryReviewAction = "approve" | "reject" | "pending";
export type GlossaryReviewConfidence = "high" | "medium" | "low";
export type GlossaryReviewTermType = "named_entity" | "story_specific" | "generic";

export interface GlossaryReviewResult {
  source: string;
  target: string;
  termType: GlossaryReviewTermType;
  action: GlossaryReviewAction;
  confidence: GlossaryReviewConfidence;
  reason: string;
  matchingApprovedTerm?: string;
}

export interface TermSuggestionContext {
  rawSourceExcerpt?: string;
  approvedMappings?: { source: string; target: string }[];
}

export interface GlossaryTermInput {
  source: string;
  target: string;
  category?: string | null;
  note?: string | null;
}
