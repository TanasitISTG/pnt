import { useLocale } from "use-intl";

import { formatCompactDateTime, parseDateTime } from "@/lib/i18n/format";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * A record's moment, in the reader's language and the app's timezone - §4's formatter rather
 * than the browser's own locale, which answered a `th-TH` reader with the Buddhist calendar.
 *
 * The compact shape is deliberate: this sits in a column beside a job's name, so the cell has
 * to stay narrower than the words next to it, while `title` still carries the exact instant an
 * operator copies into a report.
 *
 * The visible label is gated on hydration, as every dated cell in the app is, so the server
 * renders the placeholder and the client renders the formatted moment.
 */
export function DateCell({ value }: { value: Date | string }) {
  const mounted = useHydrated();
  const locale = useLocale();

  const date = parseDateTime(value);
  const iso = date?.toISOString();

  return (
    <time dateTime={iso} title={iso}>
      {mounted && date ? formatCompactDateTime(date, locale) : "—"}
    </time>
  );
}
