import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Loader2,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";

import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { JobHistoryPage, JobHistorySearch } from "@/lib/job-dashboard/contracts";
import {
  createJobHistoryColumns,
  jobHistoryTableFeatures,
  type JobHistoryColumnActions,
} from "./job-history-columns";

export type JobHistorySearchChange = (
  changes: Partial<JobHistorySearch>,
  replace?: boolean,
) => void;

export interface JobHistoryTableProps {
  history: JobHistoryPage | undefined;
  search: JobHistorySearch;
  isPending: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onSearchChange: JobHistorySearchChange;
  actions: Omit<JobHistoryColumnActions, "pendingJobId">;
  pendingJobId: string | null;
}

const columnLabels: Record<string, string> = {
  novelTitle: "Job",
  type: "Type",
  status: "Status",
  progress: "Progress",
  createdAt: "Started",
  updatedAt: "Updated",
  error: "Error",
  actions: "Actions",
};

const sortableSearchColumns: Record<string, JobHistorySearch["sort"]> = {
  novelTitle: "novelTitle",
  type: "type",
  status: "status",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

const pageSizeOptions = [10, 25, 50] as const;

const jobTypeItems: Record<string, string> = {
  all: "All types",
  translation: "Translations",
  scrape: "Scrapes",
  epub: "EPUB",
};

const jobStatusItems: Record<string, string> = {
  all: "All statuses",
  pending: "Pending",
  running: "Running",
  done: "Completed",
  error: "Failed",
  cancelled: "Cancelled",
};

const pageSizeItems: Record<string, string> = {
  "10": "10",
  "25": "25",
  "50": "50",
};

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  if (typeof updater === "function") return (updater as (old: T) => T)(current);
  return updater;
}

function hasActiveFilters(search: JobHistorySearch) {
  return search.q !== "" || search.type !== "all" || search.status !== "all";
}

function formatRange(first: number, last: number, total: number) {
  return total === 0
    ? "0 jobs"
    : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} jobs`;
}

function SkeletonRows({ columnCount }: { columnCount: number }) {
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

export function JobHistoryTable({
  history,
  search,
  isPending,
  isFetching,
  isPlaceholderData,
  isError,
  error,
  onRetry,
  onSearchChange,
  actions,
  pendingJobId,
}: JobHistoryTableProps) {
  const [queryInput, setQueryInput] = useState(search.q);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({
    createdAt: false,
  });

  useEffect(() => {
    setQueryInput(search.q);
  }, [search.q]);

  useEffect(() => {
    if (queryInput === search.q) return;
    const timeoutId = window.setTimeout(() => {
      onSearchChange({ q: queryInput, page: 1 }, true);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [onSearchChange, queryInput, search.q]);

  useEffect(() => {
    if (!history || isFetching || isPlaceholderData || history.page === search.page) return;
    onSearchChange({ page: history.page }, true);
  }, [history, isFetching, isPlaceholderData, onSearchChange, search.page]);

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: Math.max(0, search.page - 1), pageSize: search.pageSize }),
    [search.page, search.pageSize],
  );
  const sorting = useMemo<SortingState>(
    () => [{ id: search.sort, desc: search.dir === "desc" }],
    [search.dir, search.sort],
  );
  const columns = useMemo(
    () => createJobHistoryColumns({ ...actions, pendingJobId }),
    [actions, pendingJobId],
  );
  const data = history?.rows ?? [];

  const table = useTable({
    features: jobHistoryTableFeatures,
    columns,
    data,
    manualPagination: true,
    manualSorting: true,
    rowCount: history?.rowCount ?? 0,
    enableMultiSort: false,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: (updater) => {
      const next = resolveUpdater(updater, pagination);
      if (next.pageSize !== search.pageSize) {
        onSearchChange({ pageSize: next.pageSize as JobHistorySearch["pageSize"], page: 1 }, true);
        return;
      }
      const nextPage = next.pageIndex + 1;
      if (nextPage !== search.page) onSearchChange({ page: nextPage }, false);
    },
    onSortingChange: (updater) => {
      const next = resolveUpdater(updater, sorting);
      const selected = next[0];
      const sort = selected ? sortableSearchColumns[selected.id] : undefined;
      if (!sort) return;
      onSearchChange({ sort, dir: selected.desc ? "desc" : "asc", page: 1 }, true);
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  const rowCount = history?.rowCount ?? 0;
  const currentPage = history?.page ?? search.page;
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : firstRow + data.length - 1;
  const filtered = hasActiveFilters(search);
  const noRows = Boolean(history && !isFetching && data.length === 0);
  const isChangingQuery = isFetching && isPlaceholderData;
  const paginationBusy = isPlaceholderData || (isPending && !history);
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  if (isError && !history) {
    return (
      <QueryErrorState
        title="Unable to load job history"
        error={error}
        onRetry={onRetry}
        className="my-0"
      />
    );
  }
  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Job history"
      aria-busy={isFetching}
    >
      <div className="border-b border-border p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(300px,1fr)_17rem_auto] lg:items-center">
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search novel, chapter, source, or job ID"
              aria-label="Search job history"
              className="h-10 pl-9"
            />
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Select
              value={search.type}
              items={jobTypeItems}
              onValueChange={(value) => {
                if (value && value !== search.type) {
                  onSearchChange({ type: value as JobHistorySearch["type"], page: 1 }, true);
                }
              }}
            >
              <SelectTrigger
                id="job-history-type"
                aria-label="Filter by type"
                className="h-10 min-w-0 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="translation">Translations</SelectItem>
                <SelectItem value="scrape">Scrapes</SelectItem>
                <SelectItem value="epub">EPUB</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={search.status}
              items={jobStatusItems}
              onValueChange={(value) => {
                if (value && value !== search.status) {
                  onSearchChange({ status: value as JobHistorySearch["status"], page: 1 }, true);
                }
              }}
            >
              <SelectTrigger
                id="job-history-status"
                aria-label="Filter by status"
                className="h-10 min-w-0 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="done">Completed</SelectItem>
                <SelectItem value="error">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 sm:ml-auto">
            {hasActiveFilters(search) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                onClick={() =>
                  onSearchChange(
                    { q: "", type: "all", status: "all", sort: "updatedAt", dir: "desc", page: 1 },
                    true,
                  )
                }
              >
                Clear filters
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="h-10">
                    <Columns3 className="size-4" aria-hidden="true" />
                    Columns
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  {table.getAllLeafColumns().map((column) =>
                    column.getCanHide() ? (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
                      >
                        {columnLabels[column.id] ?? column.id}
                      </DropdownMenuCheckboxItem>
                    ) : null,
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 flex min-h-5 items-center justify-between gap-3 text-caption text-muted-foreground">
          <p>All retained translation and import runs</p>
          {isFetching && !isChangingQuery && (
            <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
              <Loader2
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Updating…
            </span>
          )}
        </div>
        {isChangingQuery && (
          <div
            className="mt-3 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-caption text-primary"
            role="status"
            aria-live="polite"
          >
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading job page…
          </div>
        )}
      </div>
      {isError && history && (
        <QueryErrorState
          title="Unable to update job history"
          error={error}
          onRetry={onRetry}
          className="m-3 min-h-0 sm:m-4"
        />
      )}

      <div className="overflow-x-auto">
        <Table className="min-w-[1080px] text-caption">
          <TableHeader className="bg-muted/20">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`h-11 px-3 ${
                      header.column.id === "actions"
                        ? "sticky right-0 z-10 border-l border-border bg-muted/20"
                        : ""
                    }`}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isPending && !history ? (
              <SkeletonRows columnCount={visibleColumnCount} />
            ) : noRows ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-56 px-6 text-center">
                  <div className="mx-auto max-w-sm">
                    <p className="font-medium text-foreground">
                      {filtered ? "No jobs match these filters" : "No jobs yet"}
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      {filtered
                        ? "Try a different search or clear the filters to see all retained runs."
                        : "Translation and import runs will appear here as they are created."}
                    </p>
                    {filtered && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() =>
                          onSearchChange(
                            {
                              q: "",
                              type: "all",
                              status: "all",
                              sort: "updatedAt",
                              dir: "desc",
                              page: 1,
                            },
                            true,
                          )
                        }
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : data.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="h-[4.25rem]">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`px-3 py-2 ${
                        cell.column.id === "actions"
                          ? "sticky right-0 z-10 border-l border-border bg-card"
                          : ""
                      }`}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="tabular-nums">{formatRange(firstRow, lastRow, rowCount)}</div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <span>Rows</span>
            <Select
              value={String(search.pageSize)}
              items={pageSizeItems}
              onValueChange={(value) => {
                const pageSize = Number(value);
                if (pageSizeOptions.includes(pageSize as (typeof pageSizeOptions)[number])) {
                  onSearchChange(
                    { pageSize: pageSize as JobHistorySearch["pageSize"], page: 1 },
                    true,
                  );
                }
              }}
            >
              <SelectTrigger aria-label="Rows per page" className="h-9 w-[76px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={String(pageSize)}>
                    {pageSize}
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
              disabled={!table.getCanPreviousPage() || paginationBusy}
              aria-label="First page"
            >
              <ChevronsLeft className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage() || paginationBusy}
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
              disabled={!table.getCanNextPage() || paginationBusy}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.lastPage()}
              disabled={!table.getCanLastPage() || paginationBusy}
              aria-label="Last page"
            >
              <ChevronsRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
