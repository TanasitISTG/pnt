import { useLocale, useTranslations } from "use-intl";

import { DailyBars } from "@/components/studio/analytics/daily-bars";
import { Card, CardContent } from "@/components/ui/card";
import type { AudienceDay, AudienceTotals } from "@/lib/analytics/types";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locales";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="text-sub font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function AudienceSummary({
  totals,
  daily,
}: {
  totals: AudienceTotals;
  daily: AudienceDay[];
}) {
  const t = useTranslations("analytics");
  const locale = useLocale() as Locale;
  const number = (value: number) => formatNumber(value, locale);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            <Stat label={t("readers")} value={number(totals.readers)} />
            <Stat label={t("reads")} value={number(totals.reads)} />
            <Stat label={t("followers")} value={number(totals.followers)} />
            <Stat label={t("waiting")} value={number(totals.waitingFollowers)} />
          </div>
          <p className="text-caption text-muted-foreground">{t("windowNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-caption text-muted-foreground">{t("sparklineLabel")}</span>
            <span className="text-body font-semibold tabular-nums text-foreground">
              {t("finishedInRange", { count: number(totals.reads) })}
            </span>
          </div>
          <DailyBars daily={daily} />
          <p className="text-caption text-muted-foreground">
            {totals.newestChapter
              ? t("newestChapter", {
                  number: totals.newestChapter.number,
                  title: totals.newestChapter.title,
                })
              : t("noPublishedChapter")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
