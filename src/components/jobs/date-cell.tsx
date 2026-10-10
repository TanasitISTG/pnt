import { useHydrated } from "@/lib/use-hydrated";

import { formatLocalDateTime, parseDateTime } from "@/lib/date-time";

export function DateCell({ value }: { value: Date | string }) {
  const mounted = useHydrated();

  const date = parseDateTime(value);
  const iso = date?.toISOString();

  return (
    <time dateTime={iso} title={iso}>
      {mounted && date
        ? formatLocalDateTime(date, {
            month: "numeric",
            day: "numeric",
            year: "2-digit",
            hour: "numeric",
            minute: "2-digit",
          })
        : "—"}
    </time>
  );
}
