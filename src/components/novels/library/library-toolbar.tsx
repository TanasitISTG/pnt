import { Grid2X2, List, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import {
  CATALOG_LANGUAGES,
  formatLibraryLanguage,
  LIBRARY_PUBLICATION_KEYS,
  LIBRARY_SORT_KEYS,
  type LibrarySearch,
} from "@/components/novels/library/library-search";
import type { CatalogTag } from "@/lib/content/novel/catalog.types";
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
  /** The vocabulary the filter row offers; empty on the shelf, which has no tag filter. */
  tags: readonly CatalogTag[];
  isAdmin: boolean;
  resultCount: number;
  totalCount: number;
  onSearchChange: (patch: Partial<LibrarySearch>) => void;
}

const VIEW_OPTIONS = [
  { value: "grid", labelKey: "layoutGrid", icon: <Grid2X2 />, srLabelKey: "layoutGridView" },
  { value: "list", labelKey: "layoutList", icon: <List />, srLabelKey: "layoutListView" },
] as const;

/**
 * Filters, not a panel: a sticky row that stays reachable while the shelf scrolls, one
 * line of controls on desktop, and a single results sentence with the way to clear.
 *
 * Every option's text comes from the catalog while its value stays the raw filter value, so
 * a URL keeps `sort=updated` in both languages and only the label a reader sees changes.
 */
export function LibraryToolbar({
  search,
  tags,
  isAdmin,
  resultCount,
  totalCount,
  onSearchChange,
}: LibraryToolbarProps) {
  const t = useTranslations("catalog");
  const tCommon = useTranslations("common");
  const [queryInputState, setQueryInputState] = useState({ query: search.q, input: search.q });
  let queryInput = queryInputState.input;
  if (queryInputState.query !== search.q) {
    queryInput = search.q;
    setQueryInputState({ query: search.q, input: search.q });
  }
  const onSearchChangeRef = useRef(onSearchChange);
  const languageItems = useMemo(() => {
    const items: Record<string, string> = { all: t("languageAll") };
    for (const language of CATALOG_LANGUAGES) {
      items[language] = formatLibraryLanguage(language);
    }
    return items;
  }, [t]);

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
    onSearchChangeRef.current({ q: "", language: "all", publication: "all", tag: "" });
  };

  const hasFilters =
    search.q !== "" ||
    search.language !== "all" ||
    search.tag !== "" ||
    (isAdmin && search.publication !== "all");

  const sortItems = {
    newest: t(LIBRARY_SORT_KEYS.newest),
    updated: t(LIBRARY_SORT_KEYS.updated),
    title: t(LIBRARY_SORT_KEYS.title),
  };

  const publicationItems = {
    all: t(LIBRARY_PUBLICATION_KEYS.all),
    draft: t(LIBRARY_PUBLICATION_KEYS.draft),
    scheduled: t(LIBRARY_PUBLICATION_KEYS.scheduled),
    live: t(LIBRARY_PUBLICATION_KEYS.live),
  };

  const sortSelect = (
    <Select
      value={search.sort}
      items={sortItems}
      onValueChange={(value) => {
        if (value) onSearchChange({ sort: value as LibrarySearch["sort"] });
      }}
    >
      <SelectTrigger aria-label={t("sortLabel")} className="h-9 w-full min-w-0">
        <SelectValue placeholder={sortItems.newest} />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(sortItems).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <section
      aria-label={t("filtersLabel")}
      className="sticky top-16 z-30 flex flex-col gap-3 border-b border-border bg-background/90 py-3 supports-backdrop-filter:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 lg:flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor="library-search" className="sr-only">
            {t("searchLabel")}
          </label>
          <Input
            id="library-search"
            name="q"
            autoComplete="off"
            value={queryInput}
            onChange={(event) => setQueryInputState({ query: search.q, input: event.target.value })}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className="h-9 pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:w-auto lg:items-center">
          <Select
            value={search.language}
            items={languageItems}
            onValueChange={(value) => onSearchChange({ language: value ?? "all" })}
          >
            <SelectTrigger aria-label={t("languageFilterLabel")} className="h-9 w-full min-w-0">
              <SelectValue placeholder={languageItems.all} />
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
              items={publicationItems}
              onValueChange={(value) => {
                if (value) onSearchChange({ publication: value as LibrarySearch["publication"] });
              }}
            >
              <SelectTrigger
                aria-label={t("publicationFilterLabel")}
                className="h-9 w-full min-w-0"
              >
                <SelectValue placeholder={publicationItems.all} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(publicationItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {isAdmin ? <div className="lg:w-48">{sortSelect}</div> : null}
          <SegmentedControl
            label={t("layoutLabel")}
            value={search.view}
            options={VIEW_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
              icon: option.icon,
              srLabel: t(option.srLabelKey),
            }))}
            size="sm"
            className="h-9 lg:ml-auto"
            onValueChange={(value) => onSearchChange({ view: value })}
          />
        </div>
      </div>
      {/*
       * The vocabulary, not a free-text box: a tag filter is only useful if every reader
       * picks the same tag, and the counts say which ones a catalog this size can sustain.
       */}
      {tags.length > 0 ? (
        <div
          className="-mx-1 flex flex-wrap gap-1 overflow-x-auto px-1 [scrollbar-width:thin]"
          aria-label={t("tagFilterLabel")}
        >
          <Button
            type="button"
            size="sm"
            variant={search.tag === "" ? "cream" : "ghost"}
            aria-pressed={search.tag === ""}
            onClick={() => onSearchChange({ tag: "" })}
          >
            {t("tagAll")}
          </Button>
          {tags.map((tag) => (
            <Button
              key={tag.slug}
              type="button"
              size="sm"
              variant={search.tag === tag.slug ? "cream" : "ghost"}
              aria-pressed={search.tag === tag.slug}
              onClick={() => onSearchChange({ tag: search.tag === tag.slug ? "" : tag.slug })}
            >
              {tag.name}
              <span className="text-micro tabular-nums opacity-60">{tag.count}</span>
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
        <span aria-live="polite">{t("results", { shown: resultCount, total: totalCount })}</span>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <X className="size-3.5" aria-hidden="true" />
            {tCommon("clearFilters")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
