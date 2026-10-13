import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReportCase } from "@/lib/reports/types";

import { ReportCaseTableRow } from "./report-case-row";
import { ReportTableFooter } from "./report-table-footer";

export interface ReportCaseTableProps {
  cases: ReportCase[];
  rowCount: number;
  page: number;
  pageSize: number;
  isPending: boolean;
  /** Set when a search is narrowing the queue, which changes the empty message. */
  searching: boolean;
  onPageChange: (page: number) => void;
  onReview: (reportCase: ReportCase) => void;
}

export function ReportCaseTable({
  cases,
  rowCount,
  page,
  pageSize,
  isPending,
  searching,
  onPageChange,
  onReview,
}: ReportCaseTableProps) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Target</TableHead>
            <TableHead>Reports</TableHead>
            <TableHead className="hidden sm:table-cell">State</TableHead>
            <TableHead className="hidden md:table-cell">Waiting since</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.map((reportCase) => (
            <ReportCaseTableRow
              key={reportCase.caseKey}
              row={reportCase}
              onReview={() => onReview(reportCase)}
            />
          ))}
          {!isPending && cases.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                {searching ? "No open cases match that search." : "No open reports."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <ReportTableFooter
        page={page}
        pageSize={pageSize}
        rowCount={rowCount}
        noun="cases"
        isPending={isPending}
        onPageChange={onPageChange}
      />
    </div>
  );
}
