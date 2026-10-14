import type { ReactNode } from "react";

import { Metric } from "@/components/jobs/metric";

export interface ActivityBandProps {
  /** The band's landmark name. */
  ariaLabel: string;
  label: string;
  value: number;
  detail: ReactNode;
  /**
   * Announce the count politely. The whole band is not a live region: it holds controls,
   * and a live region that contains buttons announces every focus change inside it.
   */
  live?: boolean;
  /** The page's own rows for this band, or nothing when it holds none. */
  children?: ReactNode;
}

/**
 * One lead band of the activity console.
 *
 * The console leads with what needs a decision — a run in flight, a run that failed — and
 * only then shows the retained history. It used to be the other way round: a strip of
 * four detached metric cards over a table, so nothing told a reader which run was live
 * without reading the table. The band reuses `Metric` unframed, so the number that
 * answers "how many?" is the same component it always was, now heading the rows it is
 * about instead of sitting in its own card.
 */
export function ActivityBand({
  ariaLabel,
  label,
  value,
  detail,
  live = false,
  children,
}: ActivityBandProps) {
  const metric = <Metric framed={false} label={label} value={value} detail={detail} />;

  return (
    <section aria-label={ariaLabel} className="rounded-xl border border-border bg-card p-4 sm:p-5">
      {live ? (
        <div role="status" aria-live="polite">
          {metric}
        </div>
      ) : (
        metric
      )}
      {children ? <div className="mt-4 border-t border-border">{children}</div> : null}
    </section>
  );
}
