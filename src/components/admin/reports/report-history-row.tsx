import { Link } from "@tanstack/react-router";
import { useLocale, useTranslations } from "use-intl";

import {
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
} from "@/components/admin/reports/report-labels";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import type { ReportHistoryRow } from "@/lib/reports/types";

/**
 * One decided report in the trail.
 *
 * The reporter's own words are shown here as well as in the case file: a decision is
 * only reviewable next to the claim it answered. The novel may be gone by now, which is
 * why the title comes from the row rather than from a join.
 */
export function ReportHistoryTableRow({ row }: { row: ReportHistoryRow }) {
  const t = useTranslations("admin");
  const tReports = useTranslations("reports");
  const locale = useLocale();
  const dismissed = row.status === "dismissed";

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant="outline">{reportTargetLabel(tReports, row.targetType)}</Badge>
            {row.novelId ? (
              <Link
                to="/{-$locale}/novels/$novelId"
                params={{ novelId: row.novelId }}
                className="truncate font-medium text-foreground underline-offset-3 hover:underline"
              >
                {row.novelTitle ?? t("historyUntitledNovel")}
              </Link>
            ) : (
              <span className="truncate font-medium text-foreground">
                {row.novelTitle ?? t("historyDeletedNovel")}
              </span>
            )}
          </div>
          <span className="text-caption text-muted-foreground">
            {reportReasonLabel(tReports, row.reason)}
          </span>
          {row.excerpt ? (
            <span className="line-clamp-1 max-w-72 text-caption text-muted-foreground">
              {row.excerpt}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="max-w-72 text-muted-foreground">
        <div className="flex flex-col gap-1 whitespace-normal">
          <span>{row.details ?? t("historyNoExplanation")}</span>
          <span className="text-caption">{row.reporterEmail ?? t("historyReporterRemoved")}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={dismissed ? "muted" : "destructiveOutline"}>
          {reportStatusLabel(tReports, row.status)}
        </Badge>
      </TableCell>
      <TableCell className="hidden max-w-72 text-muted-foreground sm:table-cell">
        <div className="flex flex-col gap-1 whitespace-normal">
          <span>{row.resolutionNote ?? t("historyNoNote")}</span>
          <span className="text-caption">{row.resolvedByEmail ?? t("historyOperatorRemoved")}</span>
        </div>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {formatDate(row.resolvedAt ?? row.createdAt, locale)}
      </TableCell>
    </TableRow>
  );
}
