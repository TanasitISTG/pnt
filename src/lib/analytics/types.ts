/**
 * What the owner's audience report is made of.
 *
 * A leaf module so the page, the query options and the server can name the same shapes
 * without the client graph touching the server-only read.
 */
/**
 * The windows the audience reports offer.
 *
 * `all` is the lifetime rather than a wider bucket: it is the only range whose curve has no
 * fixed length, so the server derives its day count from the first read it finds.
 */
export const AUDIENCE_RANGES = ["7d", "30d", "90d", "all"] as const;

export type AudienceRange = (typeof AUDIENCE_RANGES)[number];

export interface AudienceNewestChapter {
  id: string;
  number: number;
  title: string;
  publishedAt: Date | null;
}

export interface AudienceTotals {
  /** Distinct signed-in readers who finished at least one chapter in the range. */
  readers: number;
  /** Chapters finished in the range, counted once per reader — the reads table has no repeats. */
  reads: number;
  /** Current relation, not windowed: a follow has no "when" in this report's vocabulary. */
  followers: number;
  /** Current state, not windowed: followers with no finished read of the newest live chapter. */
  waitingFollowers: number;
  /**
   * Whether any read has ever been recorded. A window can be quiet without the audience being
   * empty, and the report's empty state is about the latter, not about the selected range.
   */
  hasAnyReads: boolean;
  newestChapter: AudienceNewestChapter | null;
}

export interface ChapterAudience {
  chapterId: string;
  number: number;
  title: string;
  translatedTitle: string | null;
  publishedAt: Date | null;
  /** Distinct readers who finished this chapter in the range. */
  readers: number;
  /** Readers whose highest finish in the range was this chapter — the drop-off curve. */
  lastReached: number;
}

export interface AudienceDay {
  /** `YYYY-MM-DD`, UTC, so a bucket never shifts with a viewer's timezone. */
  day: string;
  reads: number;
}

export interface NovelAudience {
  totals: AudienceTotals;
  chapters: ChapterAudience[];
  /** The range's days, oldest first, zero-filled; all-time runs from the first read. */
  daily: AudienceDay[];
}

export interface AccountAudienceTotals {
  /** Every novel the account owns, published or not. */
  novels: number;
  publishedNovels: number;
  /**
   * Distinct accounts that finished a chapter of any owned novel in the range. It cannot be the
   * sum of the per-novel readers: one reader of three novels is one reader of the account.
   */
  readers: number;
  reads: number;
  followers: number;
  /** Followers with no finished read of the newest live chapter of the novel they follow. */
  waitingFollowers: number;
  hasAnyReads: boolean;
}

/** One owned novel's share of the account's audience. */
export interface NovelAudienceRow {
  id: string;
  title: string;
  publishedAt: Date | null;
  readers: number;
  reads: number;
  followers: number;
  waitingFollowers: number;
}

export interface AccountAudience {
  totals: AccountAudienceTotals;
  /** One row per owned novel, most-read first; a novel nobody has read keeps its zero row. */
  novels: NovelAudienceRow[];
  /** The range's days across every owned novel, oldest first, zero-filled. */
  daily: AudienceDay[];
}
