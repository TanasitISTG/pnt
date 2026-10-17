import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReaderSearchApi } from "@/components/reader/page/use-reader-search";

export function ReaderFindBar({ search }: { search: ReaderSearchApi }) {
  const t = useTranslations("reader");
  const inputRef = useRef<HTMLInputElement>(null);
  const handledFocusRequestRef = useRef(-1);

  useEffect(() => {
    if (handledFocusRequestRef.current === search.focusRequest) return;
    handledFocusRequestRef.current = search.focusRequest;
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
      ? t("noMatches")
      : `${t("matchPosition", {
          current: search.activeIndex + 1,
          total: search.matchCount,
        })}${search.truncated ? "+" : ""}`;

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
          placeholder={t("findInChapter")}
          aria-label={t("findInChapter")}
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
        aria-label={t("previousMatch")}
        title={t("previousMatchShortcut")}
      >
        <ChevronUp className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        onClick={search.next}
        disabled={search.matchCount === 0}
        aria-label={t("nextMatch")}
        title={t("nextMatchShortcut")}
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0"
        onClick={search.close}
        aria-label={t("closeFind")}
        title={t("closeFindShortcut")}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
