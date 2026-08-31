import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  Network,
  MoreHorizontal,
  Search,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  columnVisibilityFeature,
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import type { RelationshipMapSearch } from "@/lib/relationships/query";
import type {
  CharacterProfile,
  CharacterRelationship,
  RelationshipMapV1,
} from "@/lib/relationships/schemas";

export const relationshipTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  columnVisibilityFeature,
});

type RelationshipTableFeatures = typeof relationshipTableFeatures;
const characterColumnHelper = createColumnHelper<RelationshipTableFeatures, CharacterProfile>();
const relationshipColumnHelper = createColumnHelper<
  RelationshipTableFeatures,
  CharacterRelationship
>();

export type RelationshipSearchChange = (
  changes: Partial<RelationshipMapSearch>,
  replace?: boolean,
) => void;

export interface RelationshipTableActions {
  onEditCharacter: (character: CharacterProfile) => void;
  onEditRelationship: (relationship: CharacterRelationship) => void;
  onToggle: (entryType: "character" | "relationship", entryId: string, enabled: boolean) => void;
  onAuto: (entryType: "character" | "relationship", entryId: string) => void;
  onDelete: (entryType: "character" | "relationship", entryId: string, label: string) => void;
  pending: boolean;
}

interface CharacterProfilesTableProps {
  map: RelationshipMapV1;
  search: RelationshipMapSearch;
  onSearchChange: RelationshipSearchChange;
  actions: RelationshipTableActions;
  onAdd: () => void;
}

interface DirectedRelationshipsTableProps {
  map: RelationshipMapV1;
  search: RelationshipMapSearch;
  onSearchChange: RelationshipSearchChange;
  actions: RelationshipTableActions;
  onAdd: () => void;
}

const pageSizeOptions = [10, 25, 50] as const;
const pageSizeItems: Record<string, string> = { "10": "10", "25": "25", "50": "50" };
const stateItems: Record<string, string> = {
  all: "All states",
  active: "Active",
  inactive: "Inactive",
};
const managementItems: Record<string, string> = {
  all: "All management",
  manual: "Manual",
  auto: "Auto-managed",
};
const characterColumnLabels: Record<string, string> = {
  name: "Name",
  aliases: "Aliases / gender",
  role: "Role",
  notes: "Notes / evidence",
  management: "Management",
  state: "State",
  actions: "Actions",
};
const relationshipColumnLabels: Record<string, string> = {
  name: "Speaker → listener",
  relationship: "Relationship",
  status: "Status / familiarity",
  speech: "Speech choices",
  register: "Register",
  notes: "Notes / evidence",
  management: "Management",
  state: "State",
  actions: "Actions",
};

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  if (typeof updater === "function") return (updater as (old: T) => T)(current);
  return updater;
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase();
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function formatRange(first: number, last: number, total: number, noun: string) {
  return total === 0
    ? `0 ${noun}`
    : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`;
}

function filteredSearch(search: RelationshipMapSearch) {
  return search.q !== "" || search.state !== "all" || search.management !== "all";
}

function CharacterSortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<RelationshipTableFeatures, CharacterProfile, TValue>;
  label: string;
}) {
  return <SortableHeaderContent column={column} label={label} />;
}

function RelationshipSortableHeader<TValue>({
  column,
  label,
}: {
  column: Column<RelationshipTableFeatures, CharacterRelationship, TValue>;
  label: string;
}) {
  return <SortableHeaderContent column={column} label={label} />;
}

function SortableHeaderContent<TValue, TData extends Record<string, unknown>>({
  column,
  label,
}: {
  column: Column<RelationshipTableFeatures, TData, TValue>;
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

function ManagementBadge({ locked }: { locked: boolean }) {
  return (
    <Badge variant={locked ? "default" : "outline"}>{locked ? "Manual" : "Auto-managed"}</Badge>
  );
}

function StateBadge({
  active,
  inactiveLabel = "Inactive",
}: {
  active: boolean;
  inactiveLabel?: string;
}) {
  return (
    <Badge variant={active ? "secondary" : "outline"}>{active ? "Active" : inactiveLabel}</Badge>
  );
}

function EntryActions({
  label,
  entryType,
  enabled,
  locked,
  pending,
  onEdit,
  onToggle,
  onAuto,
  onDelete,
}: {
  label: string;
  entryType: "character" | "relationship";
  enabled: boolean;
  locked: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onAuto: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${label}`}
            disabled={pending}
          />
        }
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {entryType === "character" ? "Character actions" : "Relationship actions"}
          </DropdownMenuLabel>
          <DropdownMenuItem disabled={pending} onClick={onEdit}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={pending} onClick={onToggle}>
            {enabled ? "Disable" : "Restore"}
          </DropdownMenuItem>
          {locked && (
            <DropdownMenuItem disabled={pending} onClick={onAuto}>
              Use automatic updates
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={pending} onClick={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableToolbar({
  search,
  onSearchChange,
  table,
  columnLabels,
  searchLabel,
  description,
}: {
  search: RelationshipMapSearch;
  onSearchChange: RelationshipSearchChange;
  table: {
    getAllLeafColumns: () => Array<{
      id: string;
      getCanHide: () => boolean;
      getIsVisible: () => boolean;
      toggleVisibility: (visible: boolean) => void;
    }>;
  };
  columnLabels: Record<string, string>;
  searchLabel: string;
  description: string;
}) {
  const [queryInput, setQueryInput] = useState(search.q);
  useEffect(() => setQueryInput(search.q), [search.q]);
  useEffect(() => {
    if (queryInput === search.q) return;
    const timeoutId = window.setTimeout(
      () => onSearchChange({ q: queryInput, page: 1 }, true),
      300,
    );
    return () => window.clearTimeout(timeoutId);
  }, [onSearchChange, queryInput, search.q]);

  const clear = () =>
    onSearchChange(
      { q: "", state: "all", management: "all", sort: "name", dir: "asc", page: 1 },
      true,
    );

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
            placeholder={searchLabel}
            aria-label={searchLabel}
            className="h-10 pl-9"
          />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <Select
            value={search.state}
            items={stateItems}
            onValueChange={(value) => {
              if (value && value !== search.state) {
                onSearchChange({ state: value as RelationshipMapSearch["state"], page: 1 }, true);
              }
            }}
          >
            <SelectTrigger aria-label="Filter by effective state" className="h-10 min-w-0 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={search.management}
            items={managementItems}
            onValueChange={(value) => {
              if (value && value !== search.management) {
                onSearchChange(
                  { management: value as RelationshipMapSearch["management"], page: 1 },
                  true,
                );
              }
            }}
          >
            <SelectTrigger aria-label="Filter by management" className="h-10 min-w-0 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All management</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="auto">Auto-managed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {filteredSearch(search) && (
            <Button variant="ghost" size="sm" className="h-10" onClick={clear}>
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
            <DropdownMenuContent align="end" className="w-52">
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
        <p>{description}</p>
      </div>
    </div>
  );
}

function PaginationFooter({
  noun,
  rowCount,
  currentPage,
  pageSize,
  pageCount,
  paginationBusy,
  onSearchChange,
}: {
  noun: string;
  rowCount: number;
  currentPage: number;
  pageSize: RelationshipMapSearch["pageSize"];
  pageCount: number;
  paginationBusy: boolean;
  onSearchChange: RelationshipSearchChange;
}) {
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : Math.min(rowCount, firstRow + pageSize - 1);
  const lastPage = Math.max(1, pageCount);
  const goTo = (page: number) => onSearchChange({ page }, false);
  return (
    <div className="flex flex-col gap-3 border-t border-border px-3 py-3 text-caption text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div className="tabular-nums">{formatRange(firstRow, lastRow, rowCount, noun)}</div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select
            value={String(pageSize)}
            items={pageSizeItems}
            onValueChange={(value) => {
              const nextPageSize = Number(value);
              if (pageSizeOptions.includes(nextPageSize as (typeof pageSizeOptions)[number])) {
                onSearchChange(
                  { pageSize: nextPageSize as RelationshipMapSearch["pageSize"], page: 1 },
                  true,
                );
              }
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
            onClick={() => goTo(1)}
            disabled={currentPage <= 1 || paginationBusy}
            aria-label="First page"
          >
            <ChevronsLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goTo(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1 || paginationBusy}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-16 px-1 text-center tabular-nums text-foreground">
            Page {currentPage} of {lastPage}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goTo(Math.min(lastPage, currentPage + 1))}
            disabled={currentPage >= lastPage || paginationBusy}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goTo(lastPage)}
            disabled={currentPage >= lastPage || paginationBusy}
            aria-label="Last page"
          >
            <ChevronsRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CharacterEmptyState({
  filtered,
  onClear,
  onAdd,
}: {
  filtered: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center">
      <Users className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        {filtered
          ? "No character profiles match these filters."
          : "No character profiles yet. The next ZH→TH translation or retranslation will generate this map, or you can add a profile manually."}
      </p>
      {filtered ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          Clear filters
        </Button>
      ) : (
        <Button size="sm" className="mt-4" onClick={onAdd}>
          <Users className="size-4" aria-hidden="true" />
          Add character
        </Button>
      )}
    </div>
  );
}

function RelationshipEmptyState({
  filtered,
  canAdd,
  onClear,
  onAdd,
}: {
  filtered: boolean;
  canAdd: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center">
      <Network className="mb-3 size-7 text-muted-foreground" aria-hidden="true" />
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        {filtered
          ? "No directed relationships match these filters."
          : "No directed relationships yet. They are generated from evidenced dialogue during the next ZH→TH translation or retranslation, or can be added manually."}
      </p>
      {filtered ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          Clear filters
        </Button>
      ) : (
        <Button
          size="sm"
          className="mt-4"
          onClick={onAdd}
          disabled={!canAdd}
          title={canAdd ? undefined : "Add at least 2 character profiles first."}
        >
          <Network className="size-4" aria-hidden="true" />
          Add relationship
        </Button>
      )}
    </div>
  );
}

export function CharacterProfilesTable({
  map,
  search,
  onSearchChange,
  actions,
  onAdd,
}: CharacterProfilesTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({ notes: false });
  const filteredRows = useMemo(() => {
    const query = normalize(search.q);
    return map.characters
      .filter((character) => {
        const active = character.enabled;
        const management = character.locked ? "manual" : "auto";
        if (search.state !== "all" && (search.state === "active") !== active) return false;
        if (search.management !== "all" && search.management !== management) return false;
        if (!query) return true;
        return [
          character.sourceName,
          character.targetName,
          character.aliases.join(" "),
          character.gender,
          character.role,
          character.notes,
          character.evidence,
        ].some((value) => normalize(value).includes(query));
      })
      .toSorted((left, right) => {
        let result = 0;
        if (search.sort === "name") result = compareText(left.sourceName, right.sourceName);
        if (search.sort === "state")
          result = compareText(
            left.enabled ? "active" : "inactive",
            right.enabled ? "active" : "inactive",
          );
        if (search.sort === "management")
          result = compareText(left.locked ? "manual" : "auto", right.locked ? "manual" : "auto");
        if (result === 0) return compareText(left.id, right.id);
        return search.dir === "desc" ? -result : result;
      });
  }, [map.characters, search]);
  const rowCount = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / search.pageSize));
  const currentPage = Math.min(Math.max(search.page, 1), pageCount);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * search.pageSize,
    currentPage * search.pageSize,
  );

  useEffect(() => {
    if (currentPage !== search.page) onSearchChange({ page: currentPage }, true);
  }, [currentPage, onSearchChange, search.page]);

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: currentPage - 1, pageSize: search.pageSize }),
    [currentPage, search.pageSize],
  );
  const sorting = useMemo<SortingState>(
    () => [{ id: search.sort, desc: search.dir === "desc" }],
    [search.dir, search.sort],
  );
  const columns = useMemo(
    () =>
      characterColumnHelper.columns([
        characterColumnHelper.accessor((character) => character.sourceName, {
          id: "name",
          header: ({ column }) => <CharacterSortableHeader column={column} label="Name" />,
          cell: ({ row }) => (
            <div className="min-w-[180px] max-w-[260px]" title={row.original.sourceName}>
              <p className="truncate font-medium text-foreground">{row.original.sourceName}</p>
              {row.original.targetName && (
                <p className="truncate text-caption text-muted-foreground">
                  {row.original.targetName}
                </p>
              )}
            </div>
          ),
        }),
        characterColumnHelper.accessor("aliases", {
          id: "aliases",
          header: "Aliases / gender",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="min-w-[150px] max-w-[220px] text-caption">
              <p className="truncate" title={row.original.aliases.join(", ")}>
                {row.original.aliases.length ? row.original.aliases.join(", ") : "—"}
              </p>
              <p className="mt-1 capitalize text-muted-foreground">{row.original.gender}</p>
            </div>
          ),
        }),
        characterColumnHelper.accessor("role", {
          id: "role",
          header: "Role",
          enableSorting: false,
          cell: ({ row }) => (
            <div
              className="max-w-[180px] truncate text-caption"
              title={row.original.role ?? undefined}
            >
              {row.original.role || "—"}
            </div>
          ),
        }),
        characterColumnHelper.accessor((character) => character.notes || character.evidence || "", {
          id: "notes",
          header: "Notes / evidence",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="max-w-[260px] text-caption text-muted-foreground">
              <p className="truncate" title={row.original.notes ?? undefined}>
                {row.original.notes || "—"}
              </p>
              {row.original.evidence && (
                <p className="mt-1 truncate italic" title={row.original.evidence}>
                  “{row.original.evidence}”
                </p>
              )}
            </div>
          ),
        }),
        characterColumnHelper.accessor((character) => (character.locked ? "manual" : "auto"), {
          id: "management",
          header: ({ column }) => <CharacterSortableHeader column={column} label="Management" />,
          cell: ({ row }) => <ManagementBadge locked={row.original.locked} />,
        }),
        characterColumnHelper.accessor((character) => (character.enabled ? "active" : "inactive"), {
          id: "state",
          header: ({ column }) => <CharacterSortableHeader column={column} label="State" />,
          cell: ({ row }) => <StateBadge active={row.original.enabled} />,
        }),
        characterColumnHelper.display({
          id: "actions",
          header: "",
          enableHiding: false,
          cell: ({ row }) => {
            const character = row.original;
            return (
              <EntryActions
                label={`character ${character.sourceName}`}
                entryType="character"
                enabled={character.enabled}
                locked={character.locked}
                pending={actions.pending}
                onEdit={() => actions.onEditCharacter(character)}
                onToggle={() => actions.onToggle("character", character.id, !character.enabled)}
                onAuto={() => actions.onAuto("character", character.id)}
                onDelete={() => actions.onDelete("character", character.id, character.sourceName)}
              />
            );
          },
        }),
      ]),
    [actions],
  );
  const table = useTable({
    features: relationshipTableFeatures,
    columns,
    data: pageRows,
    manualPagination: true,
    manualSorting: true,
    rowCount,
    enableMultiSort: false,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: (updater) => {
      const next = resolveUpdater(updater, pagination);
      if (next.pageSize !== search.pageSize) {
        onSearchChange(
          { pageSize: next.pageSize as RelationshipMapSearch["pageSize"], page: 1 },
          true,
        );
        return;
      }
      const nextPage = next.pageIndex + 1;
      if (nextPage !== search.page) onSearchChange({ page: nextPage }, false);
    },
    onSortingChange: (updater) => {
      const next = resolveUpdater(updater, sorting);
      const selected = next[0];
      if (!selected || !["name", "state", "management"].includes(selected.id)) return;
      onSearchChange(
        {
          sort: selected.id as RelationshipMapSearch["sort"],
          dir: selected.desc ? "desc" : "asc",
          page: 1,
        },
        true,
      );
    },
    onColumnVisibilityChange: setColumnVisibility,
  });
  const clear = () =>
    onSearchChange(
      { q: "", state: "all", management: "all", sort: "name", dir: "asc", page: 1 },
      true,
    );
  const paginationBusy = actions.pending;
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Character profiles"
      aria-busy={actions.pending}
    >
      <TableToolbar
        search={search}
        onSearchChange={onSearchChange}
        table={table}
        columnLabels={characterColumnLabels}
        searchLabel="Search characters"
        description="Profiles and name mappings used by Chinese-to-Thai translation."
      />
      <div className="overflow-x-auto">
        <Table className="min-w-[1000px] text-caption">
          <TableHeader className="bg-muted/20">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={`h-11 px-3 ${header.column.id === "actions" ? "sticky right-0 z-10 border-l border-border bg-muted/20" : ""}`}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rowCount === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="p-4">
                  <CharacterEmptyState
                    filtered={filteredSearch(search)}
                    onClear={clear}
                    onAdd={onAdd}
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="h-[4.25rem]">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`px-3 py-2 ${cell.column.id === "actions" ? "sticky right-0 z-10 border-l border-border bg-card" : ""}`}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationFooter
        noun="characters"
        rowCount={rowCount}
        currentPage={currentPage}
        pageSize={search.pageSize}
        pageCount={pageCount}
        paginationBusy={paginationBusy}
        onSearchChange={onSearchChange}
      />
    </section>
  );
}

export function DirectedRelationshipsTable({
  map,
  search,
  onSearchChange,
  actions,
  onAdd,
}: DirectedRelationshipsTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({ notes: false });
  const charactersById = useMemo(
    () => new Map(map.characters.map((character) => [character.id, character])),
    [map.characters],
  );
  const characterLabel = useCallback(
    (id: string) => charactersById.get(id)?.sourceName ?? "Unknown character",
    [charactersById],
  );
  const characterSearchLabel = useCallback(
    (id: string) => {
      const character = charactersById.get(id);
      return character
        ? `${character.sourceName} ${character.targetName ?? ""}`
        : "Unknown character";
    },
    [charactersById],
  );
  const isActive = useCallback(
    (relationship: CharacterRelationship) =>
      relationship.enabled &&
      Boolean(charactersById.get(relationship.speakerId)?.enabled) &&
      Boolean(charactersById.get(relationship.listenerId)?.enabled),
    [charactersById],
  );
  const filteredRows = useMemo(() => {
    const query = normalize(search.q);
    return map.relationships
      .filter((relationship) => {
        const active = isActive(relationship);
        const management = relationship.locked ? "manual" : "auto";
        if (search.state !== "all" && (search.state === "active") !== active) return false;
        if (search.management !== "all" && search.management !== management) return false;
        if (!query) return true;
        return [
          characterSearchLabel(relationship.speakerId),
          characterSearchLabel(relationship.listenerId),
          relationship.relationship,
          relationship.speakerStatus,
          relationship.familiarity,
          relationship.selfPronoun,
          relationship.addresseeTerm,
          relationship.sentenceParticles,
          relationship.register,
          relationship.notes,
          relationship.evidence,
        ].some((value) => normalize(value).includes(query));
      })
      .toSorted((left, right) => {
        let result = 0;
        if (search.sort === "name") {
          result = compareText(characterLabel(left.speakerId), characterLabel(right.speakerId));
          if (result === 0) {
            result = compareText(characterLabel(left.listenerId), characterLabel(right.listenerId));
          }
        }
        if (search.sort === "state") {
          result = compareText(
            isActive(left) ? "active" : "inactive",
            isActive(right) ? "active" : "inactive",
          );
        }
        if (search.sort === "management") {
          result = compareText(left.locked ? "manual" : "auto", right.locked ? "manual" : "auto");
        }
        if (result === 0) return compareText(left.id, right.id);
        return search.dir === "desc" ? -result : result;
      });
  }, [characterLabel, characterSearchLabel, isActive, map.relationships, search]);
  const rowCount = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / search.pageSize));
  const currentPage = Math.min(Math.max(search.page, 1), pageCount);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * search.pageSize,
    currentPage * search.pageSize,
  );

  useEffect(() => {
    if (currentPage !== search.page) onSearchChange({ page: currentPage }, true);
  }, [currentPage, onSearchChange, search.page]);

  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: currentPage - 1, pageSize: search.pageSize }),
    [currentPage, search.pageSize],
  );
  const sorting = useMemo<SortingState>(
    () => [{ id: search.sort, desc: search.dir === "desc" }],
    [search.dir, search.sort],
  );
  const columns = useMemo(
    () =>
      relationshipColumnHelper.columns([
        relationshipColumnHelper.accessor(
          (relationship) =>
            `${characterLabel(relationship.speakerId)} ${characterLabel(relationship.listenerId)}`,
          {
            id: "name",
            header: ({ column }) => (
              <RelationshipSortableHeader column={column} label="Speaker → listener" />
            ),
            cell: ({ row }) => (
              <div className="min-w-[210px] max-w-[280px]">
                <p className="truncate font-medium text-foreground">
                  {characterLabel(row.original.speakerId)}
                </p>
                <p className="truncate text-caption text-muted-foreground">
                  → {characterLabel(row.original.listenerId)}
                </p>
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor("relationship", {
          id: "relationship",
          header: "Relationship",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="max-w-[180px] truncate" title={row.original.relationship}>
              {row.original.relationship}
            </div>
          ),
        }),
        relationshipColumnHelper.accessor(
          (relationship) => `${relationship.speakerStatus} ${relationship.familiarity}`,
          {
            id: "status",
            header: "Status / familiarity",
            enableSorting: false,
            cell: ({ row }) => (
              <div className="min-w-[130px] text-caption">
                <p className="capitalize">{row.original.speakerStatus}</p>
                <p className="mt-1 capitalize text-muted-foreground">{row.original.familiarity}</p>
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor(
          (relationship) =>
            `${relationship.selfPronoun} ${relationship.addresseeTerm} ${relationship.sentenceParticles}`,
          {
            id: "speech",
            header: "Speech choices",
            enableSorting: false,
            cell: ({ row }) => (
              <div className="min-w-[190px] max-w-[260px] text-caption text-muted-foreground">
                <p className="truncate" title={row.original.selfPronoun ?? undefined}>
                  Self: {row.original.selfPronoun || "—"}
                </p>
                <p className="truncate" title={row.original.addresseeTerm ?? undefined}>
                  Addressee: {row.original.addresseeTerm || "—"}
                </p>
                <p className="truncate" title={row.original.sentenceParticles ?? undefined}>
                  Particles: {row.original.sentenceParticles || "—"}
                </p>
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor("register", {
          id: "register",
          header: "Register",
          enableSorting: false,
          cell: ({ row }) => (
            <div className="max-w-[140px] truncate" title={row.original.register ?? undefined}>
              {row.original.register || "—"}
            </div>
          ),
        }),
        relationshipColumnHelper.accessor(
          (relationship) => relationship.notes || relationship.evidence || "",
          {
            id: "notes",
            header: "Notes / evidence",
            enableSorting: false,
            cell: ({ row }) => (
              <div className="max-w-[260px] text-caption text-muted-foreground">
                <p className="truncate" title={row.original.notes ?? undefined}>
                  {row.original.notes || "—"}
                </p>
                {row.original.evidence && (
                  <p className="mt-1 truncate italic" title={row.original.evidence}>
                    “{row.original.evidence}”
                  </p>
                )}
              </div>
            ),
          },
        ),
        relationshipColumnHelper.accessor(
          (relationship) => (relationship.locked ? "manual" : "auto"),
          {
            id: "management",
            header: ({ column }) => (
              <RelationshipSortableHeader column={column} label="Management" />
            ),
            cell: ({ row }) => <ManagementBadge locked={row.original.locked} />,
          },
        ),
        relationshipColumnHelper.accessor(
          (relationship) => (isActive(relationship) ? "active" : "inactive"),
          {
            id: "state",
            header: ({ column }) => <RelationshipSortableHeader column={column} label="State" />,
            cell: ({ row }) => (
              <StateBadge
                active={isActive(row.original)}
                inactiveLabel={row.original.enabled ? "Inactive — character disabled" : "Disabled"}
              />
            ),
          },
        ),
        relationshipColumnHelper.display({
          id: "actions",
          header: "",
          enableHiding: false,
          cell: ({ row }) => {
            const relationship = row.original;
            const label = `${characterLabel(relationship.speakerId)} to ${characterLabel(relationship.listenerId)}`;
            return (
              <EntryActions
                label={`relationship ${label}`}
                entryType="relationship"
                enabled={relationship.enabled}
                locked={relationship.locked}
                pending={actions.pending}
                onEdit={() => actions.onEditRelationship(relationship)}
                onToggle={() =>
                  actions.onToggle("relationship", relationship.id, !relationship.enabled)
                }
                onAuto={() => actions.onAuto("relationship", relationship.id)}
                onDelete={() => actions.onDelete("relationship", relationship.id, label)}
              />
            );
          },
        }),
      ]),
    [actions, characterLabel, isActive],
  );
  const table = useTable({
    features: relationshipTableFeatures,
    columns,
    data: pageRows,
    manualPagination: true,
    manualSorting: true,
    rowCount,
    enableMultiSort: false,
    state: { pagination, sorting, columnVisibility },
    onPaginationChange: (updater) => {
      const next = resolveUpdater(updater, pagination);
      if (next.pageSize !== search.pageSize) {
        onSearchChange(
          { pageSize: next.pageSize as RelationshipMapSearch["pageSize"], page: 1 },
          true,
        );
        return;
      }
      const nextPage = next.pageIndex + 1;
      if (nextPage !== search.page) onSearchChange({ page: nextPage }, false);
    },
    onSortingChange: (updater) => {
      const next = resolveUpdater(updater, sorting);
      const selected = next[0];
      if (!selected || !["name", "state", "management"].includes(selected.id)) return;
      onSearchChange(
        {
          sort: selected.id as RelationshipMapSearch["sort"],
          dir: selected.desc ? "desc" : "asc",
          page: 1,
        },
        true,
      );
    },
    onColumnVisibilityChange: setColumnVisibility,
  });
  const clear = () =>
    onSearchChange(
      { q: "", state: "all", management: "all", sort: "name", dir: "asc", page: 1 },
      true,
    );
  const paginationBusy = actions.pending;
  const visibleColumnCount = table.getVisibleLeafColumns().length;

  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label="Directed relationships"
      aria-busy={actions.pending}
    >
      <TableToolbar
        search={search}
        onSearchChange={onSearchChange}
        table={table}
        columnLabels={relationshipColumnLabels}
        searchLabel="Search relationships"
        description="Directed speaker-to-listener facts and speech choices for translation."
      />
      <div className="overflow-x-auto">
        <Table className="min-w-[1250px] text-caption">
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
            {rowCount === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="p-4">
                  <RelationshipEmptyState
                    filtered={filteredSearch(search)}
                    canAdd={map.characters.length >= 2}
                    onClear={clear}
                    onAdd={onAdd}
                  />
                </TableCell>
              </TableRow>
            ) : (
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
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationFooter
        noun="relationships"
        rowCount={rowCount}
        currentPage={currentPage}
        pageSize={search.pageSize}
        pageCount={pageCount}
        paginationBusy={paginationBusy}
        onSearchChange={onSearchChange}
      />
    </section>
  );
}
