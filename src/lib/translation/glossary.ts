export interface GlossaryTermInput {
  source: string;
  target: string;
  category?: string | null;
}

export function filterGlossaryForChunk(
  terms: GlossaryTermInput[],
  chunkText: string,
): GlossaryTermInput[] {
  if (!terms || terms.length === 0 || !chunkText) {
    return [];
  }

  const lowerChunkText = chunkText.toLowerCase();

  const matched = terms.filter((term) => {
    if (!term.source || term.source.trim().length === 0) {
      return false;
    }

    const source = term.source.trim();
    const isCJK = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(source);

    if (isCJK) {
      return chunkText.includes(source);
    } else {
      return lowerChunkText.includes(source.toLowerCase());
    }
  });

  // Sort longest source term first to prevent partial substring confusion
  return matched.toSorted((a, b) => b.source.length - a.source.length);
}

export function formatGlossaryBlock(terms: GlossaryTermInput[]): string {
  if (!terms || terms.length === 0) {
    return "";
  }

  return terms
    .map((t) => {
      const cat = t.category ? ` (${t.category})` : "";
      return `- ${t.source.trim()} -> ${t.target.trim()}${cat}`;
    })
    .join("\n");
}
