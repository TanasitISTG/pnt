import { Grid2X2, List, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatLibraryLanguage,
  LIBRARY_LANGUAGE_ALL_LABEL,
  LIBRARY_PUBLICATION_LABELS,
  LIBRARY_SORT_LABELS,
  type LibrarySearch,
} from "@/components/novels/library/library-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface LibraryToolbarProps {
  search: LibrarySearch;
  languages: readonly string[];
  isAdmin: boolean;
  resultCount: number;
  totalCount: number;
  onSearchChange: (patch: Partial<LibrarySearch>) => void;
}

const VIEW_OPTIONS = [
  { value: "grid", label: "Grid", icon: <Grid2X2 />, srLabel: "Grid view" },
  { value: "list", label: "List", icon: <List />, srLabel: "List view" },
] as const;

/**
 * Filters, not a panel: a sticky row that stays reachable while the shelf scrolls, one
 * line of controls on desktop, and a single results sentence with the way to clear.
 */
export function LibraryToolbar({
  search,
  languages,
  isAdmin,
  resultCount,
  totalCount,
  onSearchChange,
}: LibraryToolbarProps) {
  const [queryInputState, setQueryInputState] = useState({ query: search.q, input: search.q });
  let queryInput = queryInputState.input;
  if (queryInputState.query !== search.q) {
    queryInput = search.q;
    setQueryInputState({ query: search.q, input: search.q });
  }
  const onSearchChangeRef = useRef(onSearchChange);
  const languageItems = useMemo(() => {
    const items: Record<string, string> = { all: LIBRARY_LANGUAGE_ALL_LABEL };
    for (const language of languages) items[language] = formatLibraryLanguage(language);
    return items;
  }, [languages]);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  });

  useEffect(() => {
    if (queryInput === search.q) return;
    const timeoutId = window.setTimeout(() => onSearchChangeRef.current({ q: queryInput }), 300);
    return () => window.clearTimeout(timeoutId);
  }, [queryInput, search.q]);

  const clear = () => {
    setQueryInputState({ query: search.q, input: "" });
    onSearchChangeRef.current({ q: "", language: "all", publication: "all" });
  };

  const hasFilters =
    search.q !== "" || search.language !== "all" || (isAdmin && search.publication !== "all");

  const sortSelect = (
    <Select
      value={search.sort}
      items={LIBRARY_SORT_LABELS}
      onValueChange={(value) => {
        if (value) onSearchChange({ sort: value as LibrarySearch["sort"] });
      }}
    >
      <SelectTrigger aria-label="Sort by" className="h-9 w-full min-w-0">
        <SelectValue placeholder={LIBRARY_SORT_LABELS.newest} />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(LIBRARY_SORT_LABELS).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <section
      aria-label="Library filters"
      className="sticky top-16 z-30 flex flex-col gap-3 border-b border-border bg-background/90 py-3 supports-backdrop-filter:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 lg:flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor="library-search" className="sr-only">
            Search novels
          </label>
          <Input
            id="library-search"
            name="q"
            autoComplete="off"
            value={queryInput}
            onChange={(event) => setQueryInputState({ query: search.q, input: event.target.value })}
            placeholder="Search title, author, or original title…"
            aria-label="Search novels"
            className="h-9 pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:w-auto lg:items-center">
          <Select
            value={search.language}
            items={languageItems}
            onValueChange={(value) => onSearchChange({ language: value ?? "all" })}
          >
            <SelectTrigger aria-label="Filter by language" className="h-9 w-full min-w-0">
              <SelectValue placeholder={LIBRARY_LANGUAGE_ALL_LABEL} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(languageItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin ? (
            <Select
              value={search.publication}
              items={LIBRARY_PUBLICATION_LABELS}
              onValueChange={(value) => {
                if (value) onSearchChange({ publication: value as LibrarySearch["publication"] });
              }}
            >
              <SelectTrigger aria-label="Filter by publication" className="h-9 w-full min-w-0">
                <SelectValue placeholder={LIBRARY_PUBLICATION_LABELS.all} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LIBRARY_PUBLICATION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {isAdmin ? <div className="lg:w-48">{sortSelect}</div> : null}
          <SegmentedControl
            label="Shelf layout"
            value={search.view}
            options={VIEW_OPTIONS}
            size="sm"
            className="h-9 lg:ml-auto"
            onValueChange={(value) => onSearchChange({ view: value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <span aria-live="polite">
          {resultCount} of {totalCount} {totalCount === 1 ? "novel" : "novels"}
        </span>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <X className="size-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </section>
  );
}
