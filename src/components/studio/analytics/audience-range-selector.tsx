import { useTranslations } from "use-intl";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { AUDIENCE_RANGES, type AudienceRange } from "@/lib/analytics/types";

/**
 * The window the report is read in: a lens, not a filter applied by the browser.
 *
 * The range is sent to the server, because counting a week means counting a different set of
 * rows — distinct readers in that week cannot be recovered from a month's totals. The control
 * is the app's segmented pattern rather than tabs: it owns no panel, it re-reads the one below
 * it, and `aria-pressed` is the honest thing for a screen reader to hear.
 */
export function AudienceRangeSelector({
  value,
  onValueChange,
}: {
  value: AudienceRange;
  onValueChange: (range: AudienceRange) => void;
}) {
  const t = useTranslations("analytics");
  const labels: Record<AudienceRange, string> = {
    "7d": t("range7"),
    "30d": t("range30"),
    "90d": t("range90"),
    all: t("rangeAll"),
  };

  return (
    <SegmentedControl
      value={value}
      onValueChange={onValueChange}
      label={t("rangeLabel")}
      size="sm"
      options={AUDIENCE_RANGES.map((range) => ({ value: range, label: labels[range] }))}
    />
  );
}
