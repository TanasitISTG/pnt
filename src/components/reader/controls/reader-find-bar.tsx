import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReaderSearchApi } from "@/components/reader/page/use-reader-search";

export function ReaderFindBar({ search }: { search: ReaderSearchApi }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [search.focusRequest]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        search.previous();
      } else {
        search.next();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      search.close();
    }
  };

  const status = !search.query.trim()
    ? ""
    : search.matchCount === 0
      ? "No matches"
      : `${search.activeIndex + 1} of ${search.matchCount}${search.truncated ? "+" : ""}`;

  return (
    <div className="flex min-w-0 items-center gap-1.5 pb-2">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in chapter"
          aria-label="Find in chapter"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full pl-9"
        />
      </div>
      <span
        className="shrink-0 text-right text-caption tabular-nums text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {status}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        onClick={search.previous}
        disabled={search.matchCount === 0}
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        onClick={search.next}
        disabled={search.matchCount === 0}
        aria-label="Next match"
        title="Next match (Enter)"
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        onClick={search.close}
        aria-label="Close find"
        title="Close find (Esc)"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
