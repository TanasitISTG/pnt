import { Network, Users } from "lucide-react";
import { useCallback, useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTableCells,
  DataTableDesktopRegion,
  DataTableHeaderGroups,
  DataTableMobileRegion,
  DataTablePagination,
  DataTableRowActions,
  DataTableSection,
  DataTableSortableHeader,
  DataTableToolbar,
  type DataTablePaginationTable,
  type DataTableToolbarFilter,
} from "@/components/ui/data-table-parts";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useDataTable, type DataTableFeatures } from "@/components/ui/use-data-table";
import type { RelationshipMapSearch } from "@/lib/relationships/query";
import type { RelationshipTablePage } from "./relationship-table-data";
import type { CharacterProfile, CharacterRelationship } from "@/lib/relationships/schemas";

const characterColumnHelper = createColumnHelper<DataTableFeatures, CharacterProfile>();
const relationshipColumnHelper = createColumnHelper<DataTableFeatures, CharacterRelationship>();

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
  page: RelationshipTablePage<CharacterProfile>;
  search: RelationshipMapSearch;
  onSearchChange: RelationshipSearchChange;
  actions: RelationshipTableActions;
  onAdd: () => void;
}

interface DirectedRelationshipsTableProps {
  characters: CharacterProfile[];
  page: RelationshipTablePage<CharacterRelationship>;
  search: RelationshipMapSearch;
  onSearchChange: RelationshipSearchChange;
  actions: RelationshipTableActions;
  onAdd: () => void;
}

const pageSizeOptions = [10, 25, 50] as const;
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
const sortableSearchColumns: Record<string, RelationshipMapSearch["sort"]> = {
  name: "name",
  state: "state",
  management: "management",
};

function filteredSearch(search: RelationshipMapSearch) {
  return search.q !== "" || search.state !== "all" || search.management !== "all";
}

function clearFilters(onSearchChange: RelationshipSearchChange) {
  onSearchChange(
    { q: "", state: "all", management: "all", sort: "name", dir: "asc", page: 1 },
    true,
  );
}

function buildFilters(
  search: RelationshipMapSearch,
  onSearchChange: RelationshipSearchChange,
): DataTableToolbarFilter[] {
  return [
    {
      ariaLabel: "Filter by effective state",
      value: search.state,
      items: stateItems,
      onChange: (value) =>
        onSearchChange({ state: value as RelationshipMapSearch["state"], page: 1 }, true),
    },
    {
      ariaLabel: "Filter by management",
      value: search.management,
      items: managementItems,
      onChange: (value) =>
        onSearchChange({ management: value as RelationshipMapSearch["management"], page: 1 }, true),
    },
  ];
}

function paginationTableFor(
  currentPage: number,
  pageCount: number,
  onSearchChange: RelationshipSearchChange,
): DataTablePaginationTable {
  const lastPage = Math.max(1, pageCount);
  const goTo = (page: number) => onSearchChange({ page }, false);
  return {
    firstPage: () => goTo(1),
    previousPage: () => goTo(Math.max(1, currentPage - 1)),
    nextPage: () => goTo(Math.min(lastPage, currentPage + 1)),
    lastPage: () => goTo(lastPage),
    getCanPreviousPage: () => currentPage > 1,
    getCanNextPage: () => currentPage < lastPage,
    getCanLastPage: () => currentPage < lastPage,
    getPageCount: () => lastPage,
  };
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
    <DataTableRowActions
      triggerLabel={`Actions for ${label}`}
      menuLabel={entryType === "character" ? "Character actions" : "Relationship actions"}
      pending={pending}
      triggerClassName="min-h-11 min-w-11"
      contentClassName="w-56"
      items={[
        { label: "Edit", onSelect: onEdit },
        { label: enabled ? "Disable" : "Restore", onSelect: onToggle },
        ...(locked ? [{ label: "Use automatic updates", onSelect: onAuto }] : []),
        { label: "Delete", variant: "destructive" as const, onSelect: onDelete },
      ]}
    />
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
          : "No character profiles yet. The next translation or retranslation will generate this map, or you can add a profile manually."}
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
          : "No directed relationships yet. They are generated from evidenced dialogue during the next translation or retranslation, or can be added manually."}
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

function useCharacterProfileColumns(actions: RelationshipTableActions) {
  return useMemo(
    () =>
      characterColumnHelper.columns([
        characterColumnHelper.accessor((character) => character.sourceName, {
          id: "name",
          header: ({ column }) => <DataTableSortableHeader column={column} label="Name" />,
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
          header: ({ column }) => <DataTableSortableHeader column={column} label="Management" />,
          cell: ({ row }) => <ManagementBadge locked={row.original.locked} />,
        }),
        characterColumnHelper.accessor((character) => (character.enabled ? "active" : "inactive"), {
          id: "state",
          header: ({ column }) => <DataTableSortableHeader column={column} label="State" />,
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
}

function CharacterMobileRows({
  rows,
  actions,
}: {
  rows: CharacterProfile[];
  actions: RelationshipTableActions;
}) {
  return (
    <>
      {rows.map((character) => (
        <article key={character.id} className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words font-medium text-foreground">{character.sourceName}</p>
              <p className="mt-0.5 break-words text-sm text-muted-foreground">
                {character.targetName || "No target name"}
              </p>
            </div>
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ManagementBadge locked={character.locked} />
            <StateBadge active={character.enabled} />
            <span className="text-caption text-muted-foreground">{character.gender}</span>
          </div>
          {character.aliases.length > 0 ? (
            <p className="break-words text-caption text-muted-foreground">
              Aliases: {character.aliases.join(", ")}
            </p>
          ) : null}
          {character.role || character.notes ? (
            <p className="break-words text-caption text-muted-foreground">
              {[character.role, character.notes].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </article>
      ))}
    </>
  );
}

export function CharacterProfilesTable({
  page,
  search,
  onSearchChange,
  actions,
  onAdd,
}: CharacterProfilesTableProps) {
  const { rows: pageRows, rowCount, pageCount, currentPage } = page;
  const columns = useCharacterProfileColumns(actions);
  const clear = () => clearFilters(onSearchChange);

  const { table } = useDataTable({
    columns,
    data: pageRows,
    rowCount,
    page: currentPage,
    pageSize: search.pageSize,
    sort: search.sort,
    dir: search.dir,
    sortableColumns: sortableSearchColumns,
    initialColumnVisibility: { notes: false },
    onPageSizeChange: (pageSize) =>
      onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true),
    onPageChange: (nextPage) => onSearchChange({ page: nextPage }, false),
    onSortChange: (sort, dir) => onSearchChange({ sort, dir, page: 1 }, true),
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const filtered = filteredSearch(search);
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : Math.min(rowCount, firstRow + search.pageSize - 1);

  return (
    <DataTableSection ariaLabel="Character profiles" busy={actions.pending}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel="Search characters"
        searchPlaceholder="Search characters"
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={buildFilters(search, onSearchChange)}
        columns={{ table, labels: characterColumnLabels, menuClassName: "w-52" }}
        clearLabel="Clear filters"
        filtered={filtered}
        onClearFilters={clear}
        description="Profiles and name mappings used by translation."
      />
      {rowCount === 0 ? (
        <div className="p-4 md:hidden" aria-label="Mobile character profiles" role="region">
          <CharacterEmptyState filtered={filtered} onClear={clear} onAdd={onAdd} />
        </div>
      ) : (
        <DataTableMobileRegion ariaLabel="Mobile character profiles">
          <CharacterMobileRows rows={pageRows} actions={actions} />
        </DataTableMobileRegion>
      )}

      <DataTableDesktopRegion ariaLabel="Desktop character profiles">
        <Table className="min-w-[1000px] text-caption">
          <TableHeader className="bg-muted/20">
            <DataTableHeaderGroups
              groups={table.getHeaderGroups()}
              renderHeader={(header) => <table.FlexRender header={header} />}
            />
          </TableHeader>
          <TableBody>
            {rowCount === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="p-4">
                  <CharacterEmptyState filtered={filtered} onClear={clear} onAdd={onAdd} />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="h-[4.25rem]">
                  <DataTableCells
                    cells={row.getVisibleCells()}
                    renderCell={(cell) => <table.FlexRender cell={cell} />}
                  />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableDesktopRegion>
      <DataTablePagination
        table={paginationTableFor(currentPage, pageCount, onSearchChange)}
        firstRow={firstRow}
        lastRow={lastRow}
        rowCount={rowCount}
        currentPage={currentPage}
        busy={actions.pending}
        pageSize={search.pageSize}
        pageSizeOptions={pageSizeOptions}
        noun="characters"
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}

function useDirectedRelationshipColumns(
  actions: RelationshipTableActions,
  characterLabel: (id: string) => string,
  isActive: (relationship: CharacterRelationship) => boolean,
) {
  return useMemo(
    () =>
      relationshipColumnHelper.columns([
        relationshipColumnHelper.accessor(
          (relationship) =>
            `${characterLabel(relationship.speakerId)} ${characterLabel(relationship.listenerId)}`,
          {
            id: "name",
            header: ({ column }) => (
              <DataTableSortableHeader column={column} label="Speaker → listener" />
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
            header: ({ column }) => <DataTableSortableHeader column={column} label="Management" />,
            cell: ({ row }) => <ManagementBadge locked={row.original.locked} />,
          },
        ),
        relationshipColumnHelper.accessor(
          (relationship) => (isActive(relationship) ? "active" : "inactive"),
          {
            id: "state",
            header: ({ column }) => <DataTableSortableHeader column={column} label="State" />,
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
}

function RelationshipMobileRows({
  rows,
  characterLabel,
  isActive,
  actions,
}: {
  rows: CharacterRelationship[];
  characterLabel: (id: string) => string;
  isActive: (relationship: CharacterRelationship) => boolean;
  actions: RelationshipTableActions;
}) {
  return (
    <>
      {rows.map((relationship) => {
        const label = `${characterLabel(relationship.speakerId)} to ${characterLabel(relationship.listenerId)}`;
        return (
          <article key={relationship.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-medium text-foreground">
                  {characterLabel(relationship.speakerId)}
                </p>
                <p className="mt-0.5 break-words text-sm text-muted-foreground">
                  → {characterLabel(relationship.listenerId)}
                </p>
              </div>
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
            </div>
            <p className="break-words text-foreground">{relationship.relationship}</p>
            <div className="flex flex-wrap items-center gap-2">
              <StateBadge
                active={isActive(relationship)}
                inactiveLabel={relationship.enabled ? "Inactive — character disabled" : "Disabled"}
              />
              <ManagementBadge locked={relationship.locked} />
              <span className="text-caption text-muted-foreground">
                {relationship.familiarity} · {relationship.speakerStatus}
              </span>
            </div>
            {relationship.register ||
            relationship.selfPronoun ||
            relationship.addresseeTerm ||
            relationship.sentenceParticles ? (
              <p className="break-words text-caption text-muted-foreground">
                {[
                  relationship.register,
                  relationship.selfPronoun,
                  relationship.addresseeTerm,
                  relationship.sentenceParticles,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {relationship.notes ? (
              <p className="break-words text-caption text-muted-foreground">{relationship.notes}</p>
            ) : null}
          </article>
        );
      })}
    </>
  );
}

export function DirectedRelationshipsTable({
  characters,
  page,
  search,
  onSearchChange,
  actions,
  onAdd,
}: DirectedRelationshipsTableProps) {
  const charactersById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  const characterLabel = useCallback(
    (id: string) => charactersById.get(id)?.sourceName ?? "Unknown character",
    [charactersById],
  );
  const isActive = useCallback(
    (relationship: CharacterRelationship) =>
      relationship.enabled &&
      Boolean(charactersById.get(relationship.speakerId)?.enabled) &&
      Boolean(charactersById.get(relationship.listenerId)?.enabled),
    [charactersById],
  );
  const { rows: pageRows, rowCount, pageCount, currentPage } = page;
  const columns = useDirectedRelationshipColumns(actions, characterLabel, isActive);
  const clear = () => clearFilters(onSearchChange);

  const { table } = useDataTable({
    columns,
    data: pageRows,
    rowCount,
    page: currentPage,
    pageSize: search.pageSize,
    sort: search.sort,
    dir: search.dir,
    sortableColumns: sortableSearchColumns,
    initialColumnVisibility: { notes: false },
    onPageSizeChange: (pageSize) =>
      onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true),
    onPageChange: (nextPage) => onSearchChange({ page: nextPage }, false),
    onSortChange: (sort, dir) => onSearchChange({ sort, dir, page: 1 }, true),
  });

  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const filtered = filteredSearch(search);
  const canAdd = characters.length >= 2;
  const firstRow = rowCount === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastRow = rowCount === 0 ? 0 : Math.min(rowCount, firstRow + search.pageSize - 1);

  return (
    <DataTableSection ariaLabel="Directed relationships" busy={actions.pending}>
      <DataTableToolbar
        searchValue={search.q}
        searchLabel="Search relationships"
        searchPlaceholder="Search relationships"
        onSearchChange={(q) => onSearchChange({ q, page: 1 }, true)}
        filters={buildFilters(search, onSearchChange)}
        columns={{ table, labels: relationshipColumnLabels, menuClassName: "w-52" }}
        clearLabel="Clear filters"
        filtered={filtered}
        onClearFilters={clear}
        description="Directed speaker-to-listener facts and speech choices for translation."
      />
      {rowCount === 0 ? (
        <div className="p-4 md:hidden" aria-label="Mobile directed relationships" role="region">
          <RelationshipEmptyState
            filtered={filtered}
            canAdd={canAdd}
            onClear={clear}
            onAdd={onAdd}
          />
        </div>
      ) : (
        <DataTableMobileRegion ariaLabel="Mobile directed relationships">
          <RelationshipMobileRows
            rows={pageRows}
            characterLabel={characterLabel}
            isActive={isActive}
            actions={actions}
          />
        </DataTableMobileRegion>
      )}

      <DataTableDesktopRegion ariaLabel="Desktop directed relationships">
        <Table className="min-w-[1250px] text-caption">
          <TableHeader className="bg-muted/20">
            <DataTableHeaderGroups
              groups={table.getHeaderGroups()}
              renderHeader={(header) => <table.FlexRender header={header} />}
            />
          </TableHeader>
          <TableBody>
            {rowCount === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="p-4">
                  <RelationshipEmptyState
                    filtered={filtered}
                    canAdd={canAdd}
                    onClear={clear}
                    onAdd={onAdd}
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="h-[4.25rem]">
                  <DataTableCells
                    cells={row.getVisibleCells()}
                    renderCell={(cell) => <table.FlexRender cell={cell} />}
                  />
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </DataTableDesktopRegion>
      <DataTablePagination
        table={paginationTableFor(currentPage, pageCount, onSearchChange)}
        firstRow={firstRow}
        lastRow={lastRow}
        rowCount={rowCount}
        currentPage={currentPage}
        busy={actions.pending}
        pageSize={search.pageSize}
        pageSizeOptions={pageSizeOptions}
        noun="relationships"
        onPageSizeChange={(pageSize) =>
          onSearchChange({ pageSize: pageSize as RelationshipMapSearch["pageSize"], page: 1 }, true)
        }
      />
    </DataTableSection>
  );
}
