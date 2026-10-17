import { useTranslations } from "use-intl";

import { Badge } from "@/components/ui/badge";
import type { JobHistoryStatus } from "@/lib/job-dashboard/contracts";

/**
 * One run's state, as a badge.
 *
 * The word and the treatment stay together: `done` is the only state that reads as success,
 * and only `running` carries the pulse, so a reader scanning the column reads the color and
 * the word as one thing. The words come from `jobs.*` because the history table's status
 * filter names the same five states.
 */
export function StatusBadge({ status }: { status: JobHistoryStatus }) {
  const t = useTranslations("jobs");
  switch (status) {
    case "pending":
      return <Badge variant="muted">{t("statusPending")}</Badge>;
    case "running":
      return (
        <Badge variant="warning">
          <span
            className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
            aria-hidden="true"
          />
          {t("statusRunning")}
        </Badge>
      );
    case "done":
      return <Badge variant="success">{t("statusDone")}</Badge>;
    case "error":
      return <Badge variant="destructive">{t("statusError")}</Badge>;
    case "cancelled":
      return <Badge variant="mutedOutline">{t("statusCancelled")}</Badge>;
  }
}
