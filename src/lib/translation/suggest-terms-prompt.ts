export interface SuggestedTerm {
  source: string;
  target: string;
  category: "character" | "place" | "skill" | "item" | "other";
  note?: string;
}

export function buildTermSuggestionPrompt(languagePair: string, existingSources: string[]): string {
  const existingList =
    existingSources.length > 0
      ? `Do NOT include any of the following terms which are already present in the glossary:\n${existingSources.slice(0, 100).join(", ")}`
      : "";

  return [
    `You are a terminology extraction assistant specializing in literary translation (${languagePair}).`,
    `Analyze the provided translated chapter text and identify key terms: character names, place names, special skills, items, and other recurring novel concepts.`,
    `For each term, extract its source text (original language), target translation (as used in the translated chapter), category ("character", "place", "skill", "item", or "other"), and an optional brief note.`,
    existingList,
    `CRITICAL: Return ONLY a JSON object with a single key "terms" containing an array of objects matching this exact structure:`,
    `{`,
    `  "terms": [`,
    `    { "source": "Original Term", "target": "Translated Term", "category": "character", "note": "Brief context" }`,
    `  ]`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n\n");
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
    const parsed = JSON.parse(jsonString);
    const rawArray = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.terms)
        ? parsed.terms
        : [];

    const validCategories = new Set(["character", "place", "skill", "item", "other"]);

    return rawArray
      .filter(
        (item: any) =>
          item &&
          typeof item.source === "string" &&
          typeof item.target === "string" &&
          item.source.trim().length > 0 &&
          item.target.trim().length > 0,
      )
      .map((item: any) => ({
        source: item.source.trim(),
        target: item.target.trim(),
        category: validCategories.has(String(item.category).toLowerCase())
          ? (String(item.category).toLowerCase() as SuggestedTerm["category"])
          : "other",
        note: typeof item.note === "string" ? item.note.trim() : undefined,
      }));
  } catch {
    return [];
  }
}
