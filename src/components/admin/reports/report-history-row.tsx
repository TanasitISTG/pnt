import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { describeReportReason, describeReportStatus } from "@/lib/reports/reasons";
import type { ReportHistoryRow } from "@/lib/reports/types";

/**
 * One decided report in the trail.
 *
 * The reporter's own words are shown here as well as in the case file: a decision is
 * only reviewable next to the claim it answered. The novel may be gone by now, which is
 * why the title comes from the row rather than from a join.
 */
export function ReportHistoryTableRow({ row }: { row: ReportHistoryRow }) {
  const dismissed = row.status === "dismissed";

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 flex-col gap-0.5">
          {row.novelId ? (
            <Link
              to="/novels/$novelId"
              params={{ novelId: row.novelId }}
              className="truncate font-medium text-foreground underline-offset-3 hover:underline"
            >
              {row.novelTitle ?? "Untitled novel"}
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground">
              {row.novelTitle ?? "Deleted novel"}
            </span>
          )}
          <span className="text-caption text-muted-foreground">
            {describeReportReason(row.reason)}
          </span>
        </div>
      </TableCell>
      <TableCell className="max-w-72 text-muted-foreground">
        <div className="flex flex-col gap-1 whitespace-normal">
          <span>{row.details ?? "No explanation given."}</span>
          <span className="text-caption">{row.reporterEmail ?? "Account removed"}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={dismissed ? "muted" : "destructiveOutline"}>
          {describeReportStatus(row.status)}
        </Badge>
      </TableCell>
      <TableCell className="hidden max-w-72 text-muted-foreground sm:table-cell">
        <div className="flex flex-col gap-1 whitespace-normal">
          <span>{row.resolutionNote ?? "No note recorded."}</span>
          <span className="text-caption">{row.resolvedByEmail ?? "Operator removed"}</span>
        </div>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {row.resolvedAt
          ? new Date(row.resolvedAt).toLocaleDateString()
          : new Date(row.createdAt).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}
