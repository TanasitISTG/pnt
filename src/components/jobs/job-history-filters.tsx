import { Columns3, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";

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
import type { JobHistorySearch } from "@/lib/job-dashboard/contracts";
import type { JobHistorySearchChange } from "./job-history-table";

export interface JobHistoryFilterColumn {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

interface JobHistoryFiltersProps {
  search: JobHistorySearch;
  onSearchChange: JobHistorySearchChange;
  query: {
    isFetching: boolean;
    isPlaceholderData: boolean;
  };
  columns: JobHistoryFilterColumn[];
}

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

function hasActiveFilters(search: JobHistorySearch) {
  return search.q !== "" || search.type !== "all" || search.status !== "all";
}

export function JobHistoryFilters({
  search,
  onSearchChange,
  query,
  columns,
}: JobHistoryFiltersProps) {
  const [queryInput, setQueryInput] = useState(search.q);

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

  const isChangingQuery = query.isFetching && query.isPlaceholderData;
  const clear = () => {
    setQueryInput("");
    onSearchChange(
      { q: "", type: "all", status: "all", sort: "updatedAt", dir: "desc", page: 1 },
      true,
    );
  };

  return (
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
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {columns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.checked}
                    onCheckedChange={(checked) => column.onCheckedChange(!!checked)}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-3 flex min-h-5 items-center justify-between gap-3 text-caption text-muted-foreground">
        <p>All retained translation and import runs</p>
        {query.isFetching && !isChangingQuery && (
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
  );
}
