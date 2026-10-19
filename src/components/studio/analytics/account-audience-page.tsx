import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";

import { AccountNovelTable } from "@/components/studio/analytics/account-novel-table";
import { AudienceRangeSelector } from "@/components/studio/analytics/audience-range-selector";
import { DailyBars } from "@/components/studio/analytics/daily-bars";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DEFAULT_AUDIENCE_RANGE } from "@/lib/analytics/aggregate";
import { accountAudienceQueryOptions } from "@/lib/analytics/query";
import type { AccountAudienceTotals, AudienceRange } from "@/lib/analytics/types";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The account's audience across every novel it owns.
 *
 * The per-novel tab answers what happened inside one story; this page answers the question an
 * author actually asks between them — which novel finds readers, which one people follow but
 * do not read, and whether anyone is waiting right now. Every row links back to its novel's
 * own report, so a surprising number can be checked at the depth it came from.
 *
 * The range applies here too, and to the same things: the reads and readers of the window, on
 * the totals, each novel's row and the curve. The novel and follower counts are current facts
 * and say so, so a seven-day view never pretends an older follower disappeared.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-sub font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function Totals({ totals }: { totals: AccountAudienceTotals }) {
  const t = useTranslations("analytics");
  const locale = useLocale() as Locale;
  const number = (value: number) => formatNumber(value, locale);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label={t("novels")} value={number(totals.novels)} />
          <Stat label={t("readers")} value={number(totals.readers)} />
          <Stat label={t("reads")} value={number(totals.reads)} />
          <Stat label={t("followers")} value={number(totals.followers)} />
          <Stat label={t("waiting")} value={number(totals.waitingFollowers)} />
        </div>
        <p className="text-caption text-muted-foreground">{t("windowNote")}</p>
      </CardContent>
    </Card>
  );
}

export function AccountAudiencePage() {
  const t = useTranslations("analytics");
  const locale = useLocale() as Locale;
  const [range, setRange] = useState<AudienceRange>(DEFAULT_AUDIENCE_RANGE);
  const query = useQuery(accountAudienceQueryOptions(range));

  const audience = query.data;
  const hasNovels = (audience?.totals.novels ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-section text-foreground">{t("accountTitle")}</h1>
          <p className="mt-1.5 max-w-prose text-body text-muted-foreground">
            {t("accountDescription")}
          </p>
        </div>
        <div className="self-start">
          <AudienceRangeSelector value={range} onValueChange={setRange} />
        </div>
      </div>

      {query.isError ? (
        <QueryErrorState
          error={query.error}
          title={t("accountLoadFailed")}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending || !audience ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !hasNovels ? (
        <EmptyState
          icon={<Users />}
          title={t("accountEmptyTitle")}
          description={t("accountEmptyDescription")}
        >
          <Button render={<Link to="/novels/new" />}>{t("accountEmptyAction")}</Button>
        </EmptyState>
      ) : (
        <>
          <Totals totals={audience.totals} />

          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-caption text-muted-foreground">{t("sparklineLabel")}</span>
                <span className="text-body font-semibold tabular-nums text-foreground">
                  {t("finishedInRange", {
                    count: formatNumber(audience.totals.reads, locale),
                  })}
                </span>
              </div>
              <DailyBars daily={audience.daily} />
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3">
            <h2 className="text-sub text-foreground">{t("accountTableTitle")}</h2>
            <AccountNovelTable novels={audience.novels} />
          </section>
        </>
      )}

      <p className="text-caption text-muted-foreground">{t("guestsNote")}</p>
    </div>
  );
}
