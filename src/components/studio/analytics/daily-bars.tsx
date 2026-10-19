import type { AudienceDay } from "@/lib/analytics/types";

/**
 * The range's days as bars, without a chart dependency.
 *
 * The bars are decoration for the number beside them, so they are hidden from assistive tech:
 * a screen reader gets the range's total and its label, which is the fact; individual bar
 * heights are not. A quiet day is a baseline-height mark rather than nothing, because a gap
 * would read as missing data instead of a day with no readers.
 *
 * Shared by the per-novel report and the account rollup so the same window cannot be drawn two
 * ways. The curve is a week at its shortest and a novel's whole life at its longest, so the
 * columns share the width instead of carrying a fixed gap: a lifetime would otherwise be wider
 * than the card it sits in.
 */
export function DailyBars({ daily }: { daily: AudienceDay[] }) {
  const peak = daily.reduce((max, bucket) => Math.max(max, bucket.reads), 0);
  return (
    <div
      className="grid h-12 items-end"
      style={{
        gridTemplateColumns: `repeat(${Math.max(daily.length, 1)}, minmax(0, 1fr))`,
        columnGap: daily.length > 60 ? 0 : 2,
      }}
      aria-hidden="true"
    >
      {daily.map((bucket) => {
        const height = peak === 0 ? 0 : Math.round((bucket.reads / peak) * 100);
        return (
          <span
            key={bucket.day}
            title={`${bucket.day}: ${bucket.reads}`}
            className={
              bucket.reads === 0
                ? "min-h-[2px] rounded-t-xs bg-border"
                : "min-h-[2px] rounded-t-xs bg-primary/70"
            }
            style={{ height: `${Math.max(height, bucket.reads === 0 ? 4 : 12)}%` }}
          />
        );
      })}
    </div>
  );
}
