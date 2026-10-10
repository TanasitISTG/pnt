import "@tanstack/react-start/server-only";

import { loadApprovedTermsForContext, loadPrevChapterContext } from "./job-store";

const DEFAULT_CONTEXT_TAIL_LENGTH = 500;

/**
 * Tail length for prompt context. Novel rows are normally constrained by the
 * novel form, but restored backups are not, and the tails are sliced in SQL
 * where a non-positive or fractional length is an error rather than a no-op.
 */
export function resolveContextTailLength(contextTailLength: number | null | undefined): number {
  const requested = Math.trunc(Number(contextTailLength ?? 0));
  return Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_CONTEXT_TAIL_LENGTH;
}

export type ApprovedTermRow = Awaited<ReturnType<typeof loadApprovedTermsForContext>>[number];

export interface PreviousChapterContext {
  summary: string | null;
  rawTail: string | null;
  translatedTail: string | null;
}

/**
 * Inputs the whole translation run shares: approved glossary terms and the
 * previous chapter's context tails. Loaded once in `init` and memoized, so a
 * glossary approval or previous-chapter edit made mid-run applies from the
 * next run — the relationship map still arrives with every chunk.
 */
export interface TranslationRunContext {
  terms: ApprovedTermRow[];
  previousChapter: PreviousChapterContext | null;
}

export async function loadTranslationRunContext(
  novel: { id: string; contextTailLength: number | null },
  chapter: { number: string },
): Promise<TranslationRunContext> {
  const tailLength = resolveContextTailLength(novel.contextTailLength);
  const [terms, previousChapter] = await Promise.all([
    loadApprovedTermsForContext(novel.id),
    loadPrevChapterContext(novel.id, chapter.number, tailLength),
  ]);
  return { terms, previousChapter };
}
