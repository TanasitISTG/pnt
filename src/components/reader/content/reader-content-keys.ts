interface AlignedParagraphPair {
  raw?: string | null;
  translated?: string | null;
}

export interface ReaderParagraphEntry {
  key: string;
  paragraph: string;
}

export interface ReaderParagraphPairEntry {
  key: string;
  pair: AlignedParagraphPair;
}

function nextStableKey(fingerprint: string, occurrences: Map<string, number>): string {
  const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
  occurrences.set(fingerprint, occurrence);
  return `${fingerprint}\u0000${occurrence}`;
}

export function createReaderParagraphEntries(
  paragraphs: readonly string[],
): ReaderParagraphEntry[] {
  const occurrences = new Map<string, number>();
  return paragraphs.map((paragraph) => ({
    key: nextStableKey(paragraph, occurrences),
    paragraph,
  }));
}

export function createReaderParagraphPairEntries(
  pairs: readonly AlignedParagraphPair[],
): ReaderParagraphPairEntry[] {
  const occurrences = new Map<string, number>();
  return pairs.map((pair) => {
    const fingerprint = `${pair.raw ?? ""}\u0001${pair.translated ?? ""}`;
    return { key: nextStableKey(fingerprint, occurrences), pair };
  });
}
