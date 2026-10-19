import type { AudienceDay, AudienceRange } from "./types";

const DAY_MS = 86_400_000;

/**
 * The report opens on the month, which is the window an author checks without being asked a
 * question first; the other ranges are a deliberate narrowing from there.
 */
export const DEFAULT_AUDIENCE_RANGE: AudienceRange = "30d";

const RANGE_DAYS: Record<Exclude<AudienceRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * How many days a range covers, counting today. `null` is the lifetime, which has no fixed
 * length and no start to filter on.
 */
export function audienceRangeDays(range: AudienceRange): number | null {
  return range === "all" ? null : RANGE_DAYS[range];
}

/**
 * The first moment inside a range, or `null` for all time.
 *
 * The boundary is UTC midnight of the range's earliest day, so the window is a whole number of
 * day buckets and a read at any hour of that first day is inside it. Today counts as one of the
 * days, which is why the offset is `days - 1`.
 */
export function audienceWindowStart(range: AudienceRange, now: Date): Date | null {
  const days = audienceRangeDays(range);
  if (days === null) return null;
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(startOfToday - (days - 1) * DAY_MS);
}

/**
 * How many day buckets the curve draws.
 *
 * A fixed range is its own length. All-time has to be measured, and the only honest start is
 * the first day that has a read — read from the rows the query already returned, so a lifetime
 * curve costs no extra round trip. An audience with no reads at all keeps the default month's
 * shape rather than a single bar, because a zero curve is still a curve.
 */
export function audienceBucketCount(
  range: AudienceRange,
  rows: readonly { day: string; reads: number }[],
  now: Date,
): number {
  const days = audienceRangeDays(range);
  if (days !== null) return days;

  let earliest: string | null = null;
  for (const row of rows) {
    if (earliest === null || row.day < earliest) earliest = row.day;
  }
  if (earliest === null) return RANGE_DAYS["30d"];

  const today = Date.parse(`${audienceDayKey(now)}T00:00:00.000Z`);
  const first = Date.parse(`${earliest}T00:00:00.000Z`);
  if (!Number.isFinite(today) || !Number.isFinite(first)) return RANGE_DAYS["30d"];
  return Math.max(1, Math.round((today - first) / DAY_MS) + 1);
}

/** `YYYY-MM-DD` for a moment, in UTC, which is the clock the buckets are counted on. */
export function audienceDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The window's days, oldest first, with the days nobody read showing zero.
 *
 * The database only returns days that have rows; a chart that silently drops the quiet days
 * would draw a busier month than the one that happened, so the gaps are filled here.
 */
export function fillDailyBuckets(
  rows: readonly { day: string; reads: number }[],
  now: Date,
  days = RANGE_DAYS["30d"],
): AudienceDay[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.day, row.reads);
  }

  const buckets: AudienceDay[] = [];
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(startOfToday - offset * DAY_MS).toISOString().slice(0, 10);
    buckets.push({ day, reads: counts.get(day) ?? 0 });
  }
  return buckets;
}

/** A whole-number share, and zero rather than a division when the denominator is empty. */
export function percentShare(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
