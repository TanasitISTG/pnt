import { encodeMessage } from "@/lib/i18n/message-code";

/**
 * Why a chapter may not go live yet.
 *
 * A *preflight*, not a review: every reason here is a fact read from rows the translation
 * workflow already wrote (the chapter's own text, the run that produced it, its chunk rows),
 * never a model call and never a stored evaluation. Warnings are deliberately absent from
 * this vocabulary — a residual source-script span or an unadhered glossary term is a quality
 * note the owner may act on, and blocking a publish on one would make the gate a second
 * quality reviewer. The studio shows those beside the chapter; they never decide publication.
 */
export const PUBLICATION_BLOCK_REASONS = [
  "translation-missing",
  "translation-in-flight",
  "run-incomplete",
  "chunk-failed",
  "missing-paragraphs",
] as const;

export type PublicationBlockReason = (typeof PUBLICATION_BLOCK_REASONS)[number];

export interface PublicationBlock {
  reason: PublicationBlockReason;
  /** Paragraph breaks the source has beyond the translation. */
  missingParagraphs?: number;
  /** Chunk rows of the run that are unusable: failed, empty, or absent. */
  failedChunks?: number;
  /** The run the verdict is about, when one is attributable. */
  jobId?: string;
}

/** The run that produced the chapter's current text, as the verdict needs it. */
export interface PublicationRunFacts {
  id: string;
  status: string;
  doneChunks: number;
  totalChunks: number;
}

/** Chunk rows of that run, aggregated: integers only, never the chunk text. */
export interface PublicationChunkFacts {
  total: number;
  /** Rows that failed, or carry no text — one row is one unusable chunk either way. */
  unusable: number;
}

export interface PublicationFacts {
  status: string;
  /** `translated_content` holds a nonblank body. */
  hasBody: boolean;
  activeTranslationJobId: string | null;
  rawParagraphs: number;
  translatedParagraphs: number;
  run: PublicationRunFacts | null;
  chunks: PublicationChunkFacts | null;
}

export type PublicationVerdict =
  | { publishable: true; blockers: readonly [] }
  | { publishable: false; blockers: readonly PublicationBlock[] };

/**
 * The one rule for "may this chapter *become* visible?".
 *
 * Only entry is governed: a chapter that is already live is never re-judged here, because a
 * gate that can withdraw published text would make a translation bug into a silent takedown.
 *
 * The run and chunk checks apply only when a run is attributable to the current text. A
 * chapter whose translation was written or restored by hand has no run behind it, and its
 * author's text is the thing being published — demanding a machine run there would refuse a
 * perfectly good chapter for its provenance. The paragraph check applies to every chapter,
 * because a lost paragraph is a lost paragraph whatever produced it.
 */
export function evaluatePublication(facts: PublicationFacts): PublicationVerdict {
  const blockers: PublicationBlock[] = [];

  if (facts.status !== "translated" || !facts.hasBody) {
    // Nothing else can be read meaningfully: there is no text to publish.
    return { publishable: false, blockers: [{ reason: "translation-missing" }] };
  }

  if (facts.activeTranslationJobId !== null) {
    // A run owns the chapter, so the text on hand is mid-replacement. Its run rows are the
    // previous run's, and judging either would be judging a chapter that is being rewritten.
    return { publishable: false, blockers: [{ reason: "translation-in-flight" }] };
  }

  if (
    facts.run &&
    (facts.run.status !== "done" || facts.run.doneChunks !== facts.run.totalChunks)
  ) {
    blockers.push({ reason: "run-incomplete", jobId: facts.run.id });
  } else if (facts.run && facts.chunks) {
    const absentChunks = Math.max(0, facts.run.totalChunks - facts.chunks.total);
    const failedChunks = facts.chunks.unusable + absentChunks;
    if (failedChunks > 0) {
      blockers.push({ reason: "chunk-failed", jobId: facts.run.id, failedChunks });
    }
  }

  const missingParagraphs = facts.rawParagraphs - facts.translatedParagraphs;
  if (missingParagraphs > 0) {
    blockers.push({ reason: "missing-paragraphs", missingParagraphs });
  }

  if (blockers.length > 0) return { publishable: false, blockers };
  return { publishable: true, blockers: [] };
}

/**
 * The paragraph test alone, for a text that is about to be written.
 *
 * The manual-edit path already holds both texts, so it needs no reads at all: a scheduled
 * chapter whose new translation loses a break is the one case where saving text can break a
 * promise the clock would otherwise keep.
 */
export function evaluatePublicationText(
  rawContent: string,
  translatedContent: string,
): PublicationBlock | null {
  const missingParagraphs = paragraphCount(rawContent) - paragraphCount(translatedContent);
  if (missingParagraphs <= 0) return null;
  return { reason: "missing-paragraphs", missingParagraphs };
}

const BLANK_LINE_BREAK = /\n\s*\n+/;

/**
 * Paragraph breaks as the translation pipeline contracts for them.
 *
 * Deliberately not `splitParagraphs`: that helper falls back to splitting single newlines,
 * which is right for the side-by-side reader and wrong here. The worker injects `||¶||` only
 * for blank-line breaks, so a blank-line break is the only structure a translation was ever
 * asked to preserve — counting a source's soft line breaks would refuse a translated chapter
 * for a layout difference the pipeline never promised to carry. A text with no blank line is
 * one paragraph on both sides, whatever its line breaks are.
 */
export function paragraphCount(text: string | null): number {
  if (!text) return 0;
  return text.trim().split(BLANK_LINE_BREAK).filter(Boolean).length;
}

/**
 * The words for a refusal, as a message code.
 *
 * The server has no reader, so it sends a key and the counts that key needs; the same codes
 * resolve in the studio's toast and in whatever language its reader is in.
 */
export function publicationBlockMessage(block: PublicationBlock): string {
  switch (block.reason) {
    case "translation-missing":
      return encodeMessage("errors.chapterNotTranslatedForPublish");
    case "translation-in-flight":
      return encodeMessage("errors.chapterPublishBlockedInFlight");
    case "run-incomplete":
      return encodeMessage("errors.chapterPublishBlockedIncomplete");
    case "chunk-failed":
      return encodeMessage("errors.chapterPublishBlockedChunkFailed", {
        count: block.failedChunks ?? 0,
      });
    case "missing-paragraphs":
      return encodeMessage("errors.chapterPublishBlockedMissingParagraphs", {
        count: block.missingParagraphs ?? 0,
      });
  }
}

/**
 * Revision key for the studio's readiness read.
 *
 * The read replays paragraph counts over every translated body and joins the runs behind
 * them, so it may only be reused while neither moved. `updatedAt` moves on every write to a
 * chapter — a translation, an edit, a publication change, a run starting or failing — and the
 * translated count moves when a chapter gains or loses its text, which is what makes this
 * enough to keep a cached verdict honest.
 */
export interface PublicationRevisionChapter {
  status: string;
  updatedAt: Date | string;
}

export function publicationRevisionOf(chapters: readonly PublicationRevisionChapter[]): string {
  let translatedCount = 0;
  let latestUpdatedAt = "";
  for (const chapter of chapters) {
    if (chapter.status !== "translated") continue;
    translatedCount += 1;
    const stamp = new Date(chapter.updatedAt).toISOString();
    if (stamp > latestUpdatedAt) latestUpdatedAt = stamp;
  }
  return `${translatedCount}:${latestUpdatedAt}`;
}
