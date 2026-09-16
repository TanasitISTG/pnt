import { useMemo, useState } from "react";
import {
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type SortingState,
  type TableOptions,
} from "@tanstack/react-table";

import { resolveTableUpdater } from "./data-table-parts";

export const dataTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  columnVisibilityFeature,
});

export type DataTableFeatures = typeof dataTableFeatures;

// Manual pagination/sorting wiring is identical across every server-paginated
// table: the URL search state is the source of truth, column visibility is
// local, and page-size/sort changes replace history while page moves push it.
export interface UseDataTableOptions<TData extends RowData, TSort extends string> {
  columns: NonNullable<TableOptions<DataTableFeatures, TData>["columns"]>;
  data: TData[];
  rowCount: number;
  page: number;
  pageSize: number;
  sort: TSort;
  dir: "asc" | "desc";
  sortableColumns: Partial<Record<string, TSort>>;
  getRowId?: (row: TData) => string;
  initialColumnVisibility?: ColumnVisibilityState;
  onPageSizeChange: (pageSize: number) => void;
  onPageChange: (page: number) => void;
  onSortChange: (sort: TSort, dir: "asc" | "desc") => void;
}

export function useDataTable<TData extends RowData, TSort extends string>({
  columns,
  data,
  rowCount,
  page,
  pageSize,
  sort,
  dir,
  sortableColumns,
  getRowId,
  initialColumnVisibility,
  onPageSizeChange,
  onPageChange,
  onSortChange,
}: UseDataTableOptions<TData, TSort>) {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(
    initialColumnVisibility ?? {},
  );
  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: Math.max(0, page - 1), pageSize }),
    [page, pageSize],
  );
  const sorting = useMemo<SortingState>(() => [{ id: sort, desc: dir === "desc" }], [dir, sort]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    manualPagination: true,
    manualSorting: true,
    rowCount,
    enableMultiSort: false,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: (updater) => {
      const next = resolveTableUpdater(updater, pagination);
      if (next.pageSize !== pageSize) {
        onPageSizeChange(next.pageSize);
        return;
      }
      const nextPage = next.pageIndex + 1;
      if (nextPage !== page) onPageChange(nextPage);
    },
    onSortingChange: (updater) => {
      const next = resolveTableUpdater(updater, sorting);
      const selected = next[0];
      const nextSort = selected ? sortableColumns[selected.id] : undefined;
      if (!selected || !nextSort) return;
      onSortChange(nextSort, selected.desc ? "desc" : "asc");
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  return { table };
}
