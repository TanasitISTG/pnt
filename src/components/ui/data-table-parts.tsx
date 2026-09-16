import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  MoreHorizontal,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Updater } from "@tanstack/react-table";

import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Spinner } from "./spinner";
import { TableBody, TableCell, TableHead, TableRow } from "./table";

export function resolveTableUpdater<T>(updater: Updater<T>, current: T): T {
  if (typeof updater === "function") return (updater as (old: T) => T)(current);
  return updater;
}

export function formatTableRange(first: number, last: number, total: number, noun: string) {
  return total === 0
    ? `0 ${noun}`
    : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`;
}

function DataTableSkeletonRows({ columnCount }: { columnCount: number }) {
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

interface DataTableEmptyStateProps {
  columnCount: number;
  filtered: boolean;
  emptyTitle: string;
  filteredTitle: string;
  emptyDescription: string;
  filteredDescription: string;
  onClearFilters: () => void;
}

function DataTableEmptyState({
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

export interface DataTableBodyProps {
  initialLoading: boolean;
  noRows: boolean;
  filtered: boolean;
  visibleColumnCount: number;
  rows: ReactNode;
  emptyTitle: string;
  filteredTitle: string;
  emptyDescription: string;
  filteredDescription: string;
  onClearFilters: () => void;
}

export function DataTableBody({
  initialLoading,
  noRows,
  filtered,
  visibleColumnCount,
  rows,
  emptyTitle,
  filteredTitle,
  emptyDescription,
  filteredDescription,
  onClearFilters,
}: DataTableBodyProps) {
  if (initialLoading) {
    return (
      <TableBody>
        <DataTableSkeletonRows columnCount={visibleColumnCount} />
      </TableBody>
    );
  }
  if (!noRows) return <TableBody>{rows}</TableBody>;
  return (
    <DataTableEmptyState
      columnCount={visibleColumnCount}
      filtered={filtered}
      emptyTitle={emptyTitle}
      filteredTitle={filteredTitle}
      emptyDescription={emptyDescription}
      filteredDescription={filteredDescription}
      onClearFilters={onClearFilters}
    />
  );
}

export function DataTableSection({
  ariaLabel,
  busy,
  children,
}: {
  ariaLabel: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={ariaLabel}
      aria-busy={busy}
    >
      {children}
    </section>
  );
}

export function DataTableDesktopRegion({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="hidden overflow-x-auto md:block" role="region" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function DataTableMobileRegion({
  ariaLabel,
  children,
}: {
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="divide-y divide-border md:hidden"
      role={ariaLabel ? "region" : undefined}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export function DataTableMobileLoading({ message }: { message: string }) {
  return (
    <div className="p-6 text-center text-sm text-muted-foreground" aria-live="polite">
      {message}
    </div>
  );
}

export function DataTableMobileEmpty({
  filtered,
  emptyTitle,
  filteredTitle,
  emptyDescription,
  filteredDescription,
  onClearFilters,
}: {
  filtered: boolean;
  emptyTitle: string;
  filteredTitle: string;
  emptyDescription: string;
  filteredDescription: string;
  onClearFilters: () => void;
}) {
  return (
    <div className="space-y-2 p-6 text-center">
      <p className="text-sm font-medium text-foreground">{filtered ? filteredTitle : emptyTitle}</p>
      <p className="text-caption text-muted-foreground">
        {filtered ? filteredDescription : emptyDescription}
      </p>
      {filtered ? (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

interface DataTableHeaderLike {
  id: string;
  isPlaceholder: boolean;
  column: { id: string };
}

export function DataTableHeaderGroups<THeader extends DataTableHeaderLike>({
  groups,
  renderHeader,
}: {
  groups: ReadonlyArray<{ id: string; headers: THeader[] }>;
  renderHeader: (header: THeader) => ReactNode;
}) {
  return (
    <>
      {groups.map((headerGroup) => (
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
              {header.isPlaceholder ? null : renderHeader(header)}
            </TableHead>
          ))}
        </TableRow>
      ))}
    </>
  );
}

interface DataTableCellLike {
  id: string;
  column: { id: string };
}

export function DataTableCells<TCell extends DataTableCellLike>({
  cells,
  renderCell,
}: {
  cells: ReadonlyArray<TCell>;
  renderCell: (cell: TCell) => ReactNode;
}) {
  return (
    <>
      {cells.map((cell) => (
        <TableCell
          key={cell.id}
          className={`px-3 py-2 ${
            cell.column.id === "actions" ? "sticky right-0 z-10 border-l border-border bg-card" : ""
          }`}
        >
          {renderCell(cell)}
        </TableCell>
      ))}
    </>
  );
}

interface SortableHeaderColumn {
  getIsSorted: () => false | "asc" | "desc";
  toggleSorting: (desc?: boolean) => void;
}

export function DataTableSortableHeader({
  column,
  label,
}: {
  column: SortableHeaderColumn;
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 h-8 px-2 font-semibold text-muted-foreground hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sorted === "asc" ? (
        <ChevronsUpDown className="size-3.5" aria-hidden="true" />
      ) : sorted === "desc" ? (
        <ChevronsUpDown className="size-3.5 rotate-180" aria-hidden="true" />
      ) : (
        <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
      )}
    </Button>
  );
}

export interface DataTableRowActionItem {
  label: string;
  onSelect: () => void;
  variant?: "destructive";
}

export function DataTableRowActions({
  triggerLabel,
  menuLabel,
  items,
  pending = false,
  triggerClassName,
  contentClassName = "w-48",
}: {
  triggerLabel: string;
  menuLabel: string;
  items: DataTableRowActionItem[];
  pending?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const regularItems = items.filter((item) => item.variant !== "destructive");
  const destructiveItems = items.filter((item) => item.variant === "destructive");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={triggerClassName}
            aria-label={triggerLabel}
            disabled={pending}
          />
        }
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={contentClassName}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
          {regularItems.map((item) => (
            <DropdownMenuItem key={item.label} disabled={pending} onClick={item.onSelect}>
              {item.label}
            </DropdownMenuItem>
          ))}
          {destructiveItems.length > 0 ? <DropdownMenuSeparator /> : null}
          {destructiveItems.map((item) => (
            <DropdownMenuItem
              key={item.label}
              variant="destructive"
              disabled={pending}
              onClick={item.onSelect}
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ColumnVisibilityColumn {
  id: string;
  getCanHide: () => boolean;
  getIsVisible: () => boolean;
  toggleVisibility: (visible: boolean) => void;
}

export interface DataTableToolbarFilter {
  triggerId?: string;
  ariaLabel: string;
  value: string;
  items: Record<string, string>;
  onChange: (value: string) => void;
}

export interface DataTableToolbarProps {
  searchValue: string;
  searchLabel: string;
  searchPlaceholder: string;
  onSearchChange: (query: string) => void;
  filters: DataTableToolbarFilter[];
  columns?: {
    table: { getAllLeafColumns: () => ColumnVisibilityColumn[] };
    labels: Record<string, string>;
    menuClassName?: string;
  };
  clearLabel: string;
  filtered: boolean;
  onClearFilters: () => void;
  description: string;
  query?: { isFetching: boolean; isPlaceholderData: boolean };
  busyMessage?: string;
}

export function DataTableToolbar({
  searchValue,
  searchLabel,
  searchPlaceholder,
  onSearchChange,
  filters,
  columns,
  clearLabel,
  filtered,
  onClearFilters,
  description,
  query,
  busyMessage,
}: DataTableToolbarProps) {
  const [queryInput, setQueryInput] = useState(searchValue);
  const onSearchChangeRef = useRef(onSearchChange);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  });
  useEffect(() => {
    setQueryInput(searchValue);
  }, [searchValue]);
  useEffect(() => {
    if (queryInput === searchValue) return;
    const timeoutId = window.setTimeout(() => onSearchChangeRef.current(queryInput), 300);
    return () => window.clearTimeout(timeoutId);
  }, [queryInput, searchValue]);

  const isChangingQuery = Boolean(query?.isFetching && query.isPlaceholderData);
  return (
    <div className="border-b border-border p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(300px,1fr)_20rem_auto] lg:items-center">
        <div className="relative min-w-0">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            className="h-10 pl-9"
          />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          {filters.map((filter) => (
            <Select
              key={filter.ariaLabel}
              value={filter.value}
              items={filter.items}
              onValueChange={(value) => {
                if (value && value !== filter.value) filter.onChange(value);
              }}
            >
              <SelectTrigger
                id={filter.triggerId}
                aria-label={filter.ariaLabel}
                className="h-10 min-w-0 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(filter.items).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              className="h-10"
              onClick={() => {
                setQueryInput("");
                onClearFilters();
              }}
            >
              {clearLabel}
            </Button>
          )}
          {columns ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="sm" className="h-10">
                    <Columns3 className="size-4" aria-hidden="true" />
                    Columns
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className={columns.menuClassName ?? "w-48"}>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                  {columns.table.getAllLeafColumns().map((column) =>
                    column.getCanHide() ? (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        checked={column.getIsVisible()}
                        onCheckedChange={(checked) => column.toggleVisibility(!!checked)}
                      >
                        {columns.labels[column.id] ?? column.id}
                      </DropdownMenuCheckboxItem>
                    ) : null,
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex min-h-5 items-center justify-between gap-3 text-caption text-muted-foreground">
        <p>{description}</p>
        {query?.isFetching && !isChangingQuery && (
          <span className="inline-flex items-center gap-1.5" role="status" aria-live="polite">
            <Spinner className="size-3.5" aria-hidden="true" />
            Updating…
          </span>
        )}
      </div>
      {isChangingQuery && busyMessage ? (
        <div
          className="mt-3 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-caption text-primary"
          role="status"
          aria-live="polite"
        >
          <Spinner className="size-3.5" aria-hidden="true" />
          {busyMessage}
        </div>
      ) : null}
    </div>
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
  noun: string;
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
  noun,
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
      <div className="tabular-nums">{formatTableRange(firstRow, lastRow, rowCount, noun)}</div>
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
