import { Grid2X2, List, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import {
  formatLibraryLanguage,
  LIBRARY_LANGUAGE_ALL_LABEL,
  LIBRARY_PUBLICATION_LABELS,
  LIBRARY_SORT_LABELS,
  type LibrarySearch,
} from "@/components/novels/library-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function LibraryToolbar({
  search,
  languages,
  isAdmin,
  resultCount,
  totalCount,
  onSearchChange,
}: LibraryToolbarProps) {
  const queryTimeoutRef = useRef<number | null>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const languageItems = useMemo(() => {
    const items: Record<string, string> = { all: LIBRARY_LANGUAGE_ALL_LABEL };
    for (const language of languages) items[language] = formatLibraryLanguage(language);
    return items;
  }, [languages]);

  useEffect(() => {
    window.clearTimeout(queryTimeoutRef.current ?? undefined);
    queryTimeoutRef.current = null;
    return () => window.clearTimeout(queryTimeoutRef.current ?? undefined);
  }, [search.q]);

  const handleQueryChange = (value: string) => {
    window.clearTimeout(queryTimeoutRef.current ?? undefined);
    if (value === search.q) return;
    queryTimeoutRef.current = window.setTimeout(() => {
      queryTimeoutRef.current = null;
      onSearchChange({ q: value });
    }, 300);
  };

  const clear = () => {
    window.clearTimeout(queryTimeoutRef.current ?? undefined);
    queryTimeoutRef.current = null;
    if (queryInputRef.current) queryInputRef.current.value = "";
    onSearchChange({ q: "", language: "all", publication: "all" });
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
      <SelectTrigger aria-label="Sort by" className="h-10 min-w-0 w-full lg:min-w-36">
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
      className="rounded-xl border border-border bg-card p-3 sm:p-4"
      aria-label="Library filters"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_repeat(2,minmax(150px,190px))_auto] lg:items-center">
        <div className="relative min-w-0">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor="library-search" className="sr-only">
            Search novels
          </label>
          <Input
            key={search.q}
            ref={queryInputRef}
            id="library-search"
            name="q"
            autoComplete="off"
            defaultValue={search.q}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="Search title, author, or original title…"
            aria-label="Search novels"
            className="h-10 pl-9"
          />
        </div>
        <Select
          value={search.language}
          items={languageItems}
          onValueChange={(value) => onSearchChange({ language: value ?? "all" })}
        >
          <SelectTrigger aria-label="Filter by language" className="h-10 w-full min-w-0">
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
              if (value) {
                onSearchChange({
                  publication: value as LibrarySearch["publication"],
                });
              }
            }}
          >
            <SelectTrigger aria-label="Filter by publication" className="h-10 w-full min-w-0">
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
        ) : (
          sortSelect
        )}
        <div className="flex items-center justify-between gap-2 lg:justify-end">
          {isAdmin && sortSelect}
          <div
            className="flex items-center gap-1 rounded-md border border-border p-1"
            aria-label="Library view"
          >
            <Button
              type="button"
              variant={search.view === "grid" ? "outline" : "ghost"}
              size="icon-sm"
              aria-label="Grid view"
              aria-pressed={search.view === "grid"}
              onClick={() => onSearchChange({ view: "grid" })}
            >
              <Grid2X2 className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={search.view === "list" ? "outline" : "ghost"}
              size="icon-sm"
              aria-label="List view"
              aria-pressed={search.view === "list"}
              onClick={() => onSearchChange({ view: "list" })}
            >
              <List className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5" aria-live="polite">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          {resultCount} of {totalCount} {totalCount === 1 ? "novel" : "novels"}
        </span>
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <X className="size-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        )}
      </div>
    </section>
  );
}
