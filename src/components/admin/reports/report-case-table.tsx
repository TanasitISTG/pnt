import { useTranslations } from "use-intl";

import { TablePager } from "@/components/admin/table-pager";
import { DataTableSection } from "@/components/ui/data-table-parts";
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
  const t = useTranslations("admin");
  return (
    <DataTableSection ariaLabel={t("casesAria")} busy={isPending}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columnTarget")}</TableHead>
            <TableHead>{t("columnReports")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("columnState")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("columnWaitingSince")}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{t("columnActions")}</span>
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
                {searching ? t("casesEmptySearch") : t("casesEmpty")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <TablePager
        page={page}
        pageSize={pageSize}
        rowCount={rowCount}
        noun={t("nounCases")}
        isPending={isPending}
        onPageChange={onPageChange}
      />
    </DataTableSection>
  );
}
