import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useTranslations } from "use-intl";

import { AudienceRangeSelector } from "@/components/studio/analytics/audience-range-selector";
import { AudienceSummary } from "@/components/studio/analytics/audience-summary";
import { ChapterAudienceTable } from "@/components/studio/analytics/chapter-audience-table";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DEFAULT_AUDIENCE_RANGE } from "@/lib/analytics/aggregate";
import { audienceQueryOptions } from "@/lib/analytics/query";
import type { AudienceRange } from "@/lib/analytics/types";

/**
 * The owner's audience screen.
 *
 * It is a studio section rather than a card on the reading page because it is management
 * information: how many people finished what, where they stopped, and how many are waiting for
 * a release. The report itself is read-only — nothing here edits a chapter or a reader.
 *
 * The range is state in the page, not in the URL: the report is unshared workspace, and the
 * query key carries the range so switching back to a window already read is instant. The
 * selector sits above the report with the heading, because it changes every figure below it —
 * a quiet week is still a report, and only a novel nobody ever read gets the empty state.
 */
export function AnalyticsPage({ novelId }: { novelId: string }) {
  const t = useTranslations("analytics");
  const [range, setRange] = useState<AudienceRange>(DEFAULT_AUDIENCE_RANGE);
  const query = useQuery(audienceQueryOptions(novelId, range));

  const audience = query.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-section text-foreground">{t("title")}</h1>
          <p className="mt-1.5 max-w-prose text-body text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <AudienceRangeSelector value={range} onValueChange={setRange} />
          {/* The rollup is where an author compares novels; this is the way up from the one
              they are looking at. */}
          <Button variant="ghost" size="sm" render={<Link to="/audience" />}>
            {t("allNovels")}
          </Button>
        </div>
      </div>

      {query.isError ? (
        <QueryErrorState
          error={query.error}
          title={t("loadFailed")}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending || !audience ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !audience.totals.hasAnyReads ? (
        <EmptyState icon={<Users />} title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <>
          <AudienceSummary totals={audience.totals} daily={audience.daily} />
          {audience.chapters.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-sub text-foreground">{t("tableTitle")}</h2>
              <ChapterAudienceTable
                chapters={audience.chapters}
                totalReaders={audience.totals.readers}
              />
            </section>
          ) : null}
        </>
      )}

      <p className="text-caption text-muted-foreground">{t("guestsNote")}</p>
    </div>
  );
}
