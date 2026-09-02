import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "./button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { TableBody, TableCell, TableRow } from "./table";

export function DataTableSkeletonRows({ columnCount }: { columnCount: number }) {
  return (
    <>
      {Array.from({ length: 7 }, (_, skeletonIndex) => (
        <TableRow key={`skeleton-${skeletonIndex}`} aria-hidden="true">
          {Array.from({ length: columnCount }, (_cellPlaceholder, cellIndex) => (
            <TableCell key={`skeleton-${skeletonIndex}-${cellIndex}`}>
              <div className="h-4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export interface DataTableEmptyStateProps {
  columnCount: number;
  filtered: boolean;
  emptyTitle: string;
  filteredTitle: string;
  emptyDescription: string;
  filteredDescription: string;
  onClearFilters: () => void;
}

export function DataTableEmptyState({
  columnCount,
  filtered,
  emptyTitle,
  filteredTitle,
  emptyDescription,
  filteredDescription,
  onClearFilters,
}: DataTableEmptyStateProps) {
  return (
    <TableBody>
      <TableRow>
        <TableCell colSpan={columnCount} className="h-56 px-6 text-center">
          <div className="mx-auto max-w-sm">
            <p className="font-medium text-foreground">{filtered ? filteredTitle : emptyTitle}</p>
            <p className="mt-1 text-caption text-muted-foreground">
              {filtered ? filteredDescription : emptyDescription}
            </p>
            {filtered ? (
              <Button variant="outline" size="sm" className="mt-4" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

export interface DataTablePaginationTable {
  firstPage: () => void;
  previousPage: () => void;
  nextPage: () => void;
  lastPage: () => void;
  getCanPreviousPage: () => boolean;
  getCanNextPage: () => boolean;
  getCanLastPage: () => boolean;
  getPageCount: () => number;
}

export interface DataTablePaginationProps {
  table: DataTablePaginationTable;
  firstRow: number;
  lastRow: number;
  rowCount: number;
  currentPage: number;
  busy: boolean;
  pageSize: number;
  pageSizeOptions: readonly number[];
  formatRange: (first: number, last: number, total: number) => string;
  onPageSizeChange: (pageSize: number) => void;
}

export function DataTablePagination({
  table,
  firstRow,
  lastRow,
  rowCount,
  currentPage,
  busy,
  pageSize,
  pageSizeOptions,
  formatRange,
  onPageSizeChange,
}: DataTablePaginationProps) {
  const pageSizeItems = Object.fromEntries(
    pageSizeOptions.map((option) => [String(option), String(option)]),
  );
  const previousDisabled = !table.getCanPreviousPage() || busy;
  const nextDisabled = !table.getCanNextPage() || busy;
  const lastDisabled = !table.getCanLastPage() || busy;
  return (
    <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div className="tabular-nums">{formatRange(firstRow, lastRow, rowCount)}</div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select
            value={String(pageSize)}
            items={pageSizeItems}
            onValueChange={(value) => {
              const next = Number(value);
              if (pageSizeOptions.includes(next)) onPageSizeChange(next);
            }}
          >
            <SelectTrigger aria-label="Rows per page" className="h-9 w-[76px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.firstPage()}
            disabled={previousDisabled}
            aria-label="First page"
          >
            <ChevronsLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={previousDisabled}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-16 px-1 text-center tabular-nums text-foreground">
            Page {currentPage} of {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={nextDisabled}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.lastPage()}
            disabled={lastDisabled}
            aria-label="Last page"
          >
            <ChevronsRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
