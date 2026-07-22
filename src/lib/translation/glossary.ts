export interface GlossaryTermInput {
  source: string;
  target: string;
  category?: string | null;
}

const CJK_RE = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;

function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019\u201C\u201D]/g, (c) => (c === "\u2018" || c === "\u2019" ? "'" : '"'))
    .trim();
}

export function filterGlossaryForChunk(
  terms: GlossaryTermInput[],
  chunkText: string,
): GlossaryTermInput[] {
  if (!terms || terms.length === 0 || !chunkText) {
    return [];
  }

  const normalizedChunk = normalizeForMatch(chunkText);
  const lowerChunk = normalizedChunk.toLowerCase();

  const matched = terms.filter((term) => {
    if (!term.source || term.source.trim().length === 0) {
      return false;
    }

    const source = normalizeForMatch(term.source);
    const isCJK = CJK_RE.test(source);

    if (isCJK) {
      return normalizedChunk.includes(source);
    } else {
      return lowerChunk.includes(source.toLowerCase());
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
