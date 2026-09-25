// Shared prose-relative reader geometry. Document-level scroll heights include the app
// footer and the reader footer nav, so chapter progress, saved positions and restores all
// measure the prose element itself against the pinned toolbar offset.

export interface ReaderScrollRange {
  start: number;
  end: number;
  scrollable: boolean;
}

export function getReaderScrollRange(prose: HTMLElement, topInset: number): ReaderScrollRange {
  const rect = prose.getBoundingClientRect();
  const proseTop = rect.top + window.scrollY;
  const proseBottom = rect.bottom + window.scrollY;
  const start = Math.max(0, proseTop - topInset);
  const end = Math.max(start, proseBottom - window.innerHeight);
  // Prose that fits above the fold has equal bounds; callers treat it as fully viewed
  // rather than as a zero-length scroll range.
  if (end <= start) return { start, end: start, scrollable: false };
  return { start, end, scrollable: true };
}

// One formula for the indicator and the persisted fraction, so the saved value and the
// rendered percentage can never disagree about the bounds.
export function getReaderScrollFraction(prose: HTMLElement, topInset: number): number | null {
  const { start, end, scrollable } = getReaderScrollRange(prose, topInset);
  if (!scrollable) return null;
  return Math.min(1, Math.max(0, (window.scrollY - start) / (end - start)));
}

// The sticky toolbar covers the top of the prose. Its pinned offset is the resolved `top`
// (zero when `auto`) plus the height it actually occupies, never its current viewport rect.
export function getReaderTopInset(toolbar: HTMLElement): number {
  const top = Number.parseFloat(window.getComputedStyle(toolbar).top);
  return (Number.isFinite(top) ? top : 0) + toolbar.getBoundingClientRect().height;
}
