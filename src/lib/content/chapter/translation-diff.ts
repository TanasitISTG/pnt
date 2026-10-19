import { splitParagraphs } from "@/lib/translation/text/paragraphs";

/**
 * A paragraph-level diff of two translations of the same chapter.
 *
 * Paragraphs, not characters, because that is the unit a translator actually changed when
 * they fixed a name or a sentence, and the unit the reader scans in the history view. The
 * algorithm is patience diff: paragraphs that occur exactly once on each side anchor the
 * comparison, and the gaps between anchors are diffed recursively. That keeps a glossary pass
 * that renamed one term across a hundred paragraphs to a hundred small edits rather than one
 * enormous replacement, and it costs roughly O(n log n) in practice instead of the O(n·m) a
 * plain LCS table would spend on a chapter.
 *
 * A gap with no unique anchor and too many paragraphs for the LCS table falls back to
 * "everything here was removed, everything there was added" — an honest answer, just a
 * coarser one, and never a wrong one.
 */
export type ParagraphDiffKind = "same" | "added" | "removed";

export interface ParagraphDiffLine {
  kind: ParagraphDiffKind;
  text: string;
}

export interface ParagraphDiff {
  lines: ParagraphDiffLine[];
  added: number;
  removed: number;
  unchanged: number;
}

/** Above this many table cells the fallback block diff is used instead of LCS. */
const LCS_CELL_LIMIT = 120_000;

export function diffParagraphs(
  before: readonly string[],
  after: readonly string[],
): ParagraphDiffLine[] {
  const lines: ParagraphDiffLine[] = [];
  diffRange(before, 0, before.length, after, 0, after.length, lines);
  return lines;
}

export function diffChapterTranslations(before: string, after: string): ParagraphDiff {
  const lines = diffParagraphs(splitParagraphs(before), splitParagraphs(after));
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.kind === "added") added += 1;
    else if (line.kind === "removed") removed += 1;
    else unchanged += 1;
  }
  return { lines, added, removed, unchanged };
}

function diffRange(
  before: readonly string[],
  beforeStart: number,
  beforeEnd: number,
  after: readonly string[],
  afterStart: number,
  afterEnd: number,
  out: ParagraphDiffLine[],
): void {
  // Common prefix and suffix are unchanged by definition; trimming them first is what keeps
  // a one-paragraph edit in a long chapter cheap.
  while (
    beforeStart < beforeEnd &&
    afterStart < afterEnd &&
    before[beforeStart] === after[afterStart]
  ) {
    out.push({ kind: "same", text: before[beforeStart] });
    beforeStart += 1;
    afterStart += 1;
  }

  let suffix = 0;
  while (
    beforeEnd - suffix > beforeStart &&
    afterEnd - suffix > afterStart &&
    before[beforeEnd - 1 - suffix] === after[afterEnd - 1 - suffix]
  ) {
    suffix += 1;
  }

  const innerBeforeEnd = beforeEnd - suffix;
  const innerAfterEnd = afterEnd - suffix;

  if (beforeStart === innerBeforeEnd || afterStart === innerAfterEnd) {
    pushBlock(before, beforeStart, innerBeforeEnd, "removed", out);
    pushBlock(after, afterStart, innerAfterEnd, "added", out);
  } else {
    const anchors = uniqueAnchors(
      before,
      beforeStart,
      innerBeforeEnd,
      after,
      afterStart,
      innerAfterEnd,
    );
    if (anchors.length > 0) {
      let previousBefore = beforeStart;
      let previousAfter = afterStart;
      for (const anchor of anchors) {
        diffRange(before, previousBefore, anchor.before, after, previousAfter, anchor.after, out);
        out.push({ kind: "same", text: before[anchor.before] });
        previousBefore = anchor.before + 1;
        previousAfter = anchor.after + 1;
      }
      diffRange(before, previousBefore, innerBeforeEnd, after, previousAfter, innerAfterEnd, out);
    } else {
      const beforeCount = innerBeforeEnd - beforeStart;
      const afterCount = innerAfterEnd - afterStart;
      if (beforeCount * afterCount > LCS_CELL_LIMIT) {
        pushBlock(before, beforeStart, innerBeforeEnd, "removed", out);
        pushBlock(after, afterStart, innerAfterEnd, "added", out);
      } else {
        pushLcs(before, beforeStart, innerBeforeEnd, after, afterStart, innerAfterEnd, out);
      }
    }
  }

  for (let index = suffix; index > 0; index -= 1) {
    out.push({ kind: "same", text: before[beforeEnd - index] });
  }
}

function pushBlock(
  source: readonly string[],
  start: number,
  end: number,
  kind: ParagraphDiffKind,
  out: ParagraphDiffLine[],
): void {
  for (let index = start; index < end; index += 1) {
    out.push({ kind, text: source[index] });
  }
}

/**
 * Paragraphs that appear exactly once in each range, in the order both sides agree on.
 *
 * The order constraint is a longest increasing subsequence over the other side's positions:
 * a paragraph that moved to a different place in the chapter is not an anchor, because
 * "same text, new position" is exactly what the diff should show as moved content.
 */
function uniqueAnchors(
  before: readonly string[],
  beforeStart: number,
  beforeEnd: number,
  after: readonly string[],
  afterStart: number,
  afterEnd: number,
): Array<{ before: number; after: number }> {
  const beforePositions = new Map<string, number>();
  for (let index = beforeStart; index < beforeEnd; index += 1) {
    const text = before[index];
    beforePositions.set(text, beforePositions.has(text) ? -1 : index);
  }

  const afterPositions = new Map<string, number>();
  for (let index = afterStart; index < afterEnd; index += 1) {
    const text = after[index];
    afterPositions.set(text, afterPositions.has(text) ? -1 : index);
  }

  const candidates: Array<{ before: number; after: number }> = [];
  for (let index = beforeStart; index < beforeEnd; index += 1) {
    const text = before[index];
    if (beforePositions.get(text) !== index) continue;
    const afterIndex = afterPositions.get(text);
    if (afterIndex === undefined || afterIndex < 0) continue;
    candidates.push({ before: index, after: afterIndex });
  }

  return longestIncreasing(candidates);
}

function longestIncreasing(
  candidates: Array<{ before: number; after: number }>,
): Array<{ before: number; after: number }> {
  const tails: number[] = [];
  const previous = Array.from<number>({ length: candidates.length }).fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    const value = candidates[index].after;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candidates[tails[middle]].after < value) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }

  const sequence: Array<{ before: number; after: number }> = [];
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor !== -1) {
    sequence.push(candidates[cursor]);
    cursor = previous[cursor];
  }
  return sequence.toReversed();
}

/** Classic LCS, used only for gaps small enough that the table is cheaper than a block. */
function pushLcs(
  before: readonly string[],
  beforeStart: number,
  beforeEnd: number,
  after: readonly string[],
  afterStart: number,
  afterEnd: number,
  out: ParagraphDiffLine[],
): void {
  const rows = beforeEnd - beforeStart;
  const columns = afterEnd - afterStart;
  const width = columns + 1;
  const table = new Int32Array((rows + 1) * width);

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[row * width + column] =
        before[beforeStart + row] === after[afterStart + column]
          ? table[(row + 1) * width + column + 1] + 1
          : Math.max(table[(row + 1) * width + column], table[row * width + column + 1]);
    }
  }

  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (before[beforeStart + row] === after[afterStart + column]) {
      out.push({ kind: "same", text: before[beforeStart + row] });
      row += 1;
      column += 1;
    } else if (table[(row + 1) * width + column] >= table[row * width + column + 1]) {
      out.push({ kind: "removed", text: before[beforeStart + row] });
      row += 1;
    } else {
      out.push({ kind: "added", text: after[afterStart + column] });
      column += 1;
    }
  }

  pushBlock(before, beforeStart + row, beforeEnd, "removed", out);
  pushBlock(after, afterStart + column, afterEnd, "added", out);
}
