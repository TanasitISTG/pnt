import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReportHistoryRow } from "@/lib/reports/types";

import { ReportHistoryTableRow } from "./report-history-row";
import { ReportTableFooter } from "./report-table-footer";

export interface ReportHistoryTableProps {
  rows: ReportHistoryRow[];
  rowCount: number;
  page: number;
  pageSize: number;
  isPending: boolean;
  searching: boolean;
  onPageChange: (page: number) => void;
}

export function ReportHistoryTable({
  rows,
  rowCount,
  page,
  pageSize,
  isPending,
  searching,
  onPageChange,
}: ReportHistoryTableProps) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Novel</TableHead>
            <TableHead>Report</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead className="hidden sm:table-cell">Note</TableHead>
            <TableHead className="hidden md:table-cell">Decided</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <ReportHistoryTableRow key={row.id} row={row} />
          ))}
          {!isPending && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                {searching
                  ? "No decided reports match that search."
                  : "No reports have been decided yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <ReportTableFooter
        page={page}
        pageSize={pageSize}
        rowCount={rowCount}
        noun="reports"
        isPending={isPending}
        onPageChange={onPageChange}
      />
    </div>
  );
}
