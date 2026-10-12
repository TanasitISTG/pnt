import { Button } from "@/components/ui/button";
import { formatTableRange } from "@/components/ui/data-table-parts";

export interface ReportTableFooterProps {
  page: number;
  pageSize: number;
  rowCount: number;
  /** The noun the range is counted in, e.g. "cases" or "reports". */
  noun: string;
  isPending: boolean;
  onPageChange: (page: number) => void;
}

/**
 * The pager both report tables share. Page one is expressed by omitting the search
 * parameter rather than writing `page=1`, so the queue's default URL stays clean.
 */
export function ReportTableFooter({
  page,
  pageSize,
  rowCount,
  noun,
  isPending,
  onPageChange,
}: ReportTableFooterProps) {
  const pageCount = Math.max(1, Math.ceil(rowCount / pageSize));

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
      <span className="text-caption text-muted-foreground">
        {formatTableRange(
          rowCount === 0 ? 0 : (page - 1) * pageSize + 1,
          Math.min(page * pageSize, rowCount),
          rowCount,
          noun,
        )}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || isPending}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount || isPending}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
