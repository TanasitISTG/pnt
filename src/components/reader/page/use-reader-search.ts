import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";

import type { ReaderColumn, ReaderViewMode } from "@/lib/reader/types";
import {
  buildReaderSearchTargets,
  collectReaderSearchMatches,
  highlightsForParagraph,
  READER_SEARCH_ACTIVE_MARK_ID,
  READER_SEARCH_MATCH_LIMIT,
  type ReaderParagraphHighlights,
} from "@/lib/reader/search";

export interface ReaderSearchApi {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  openFind: () => void;
  close: () => void;
  focusRequest: number;
  matchCount: number;
  truncated: boolean;
  activeIndex: number;
  next: () => void;
  previous: () => void;
  highlightsFor: (
    paragraphIndex: number,
    column: ReaderColumn | null,
  ) => ReaderParagraphHighlights | undefined;
}

interface UseReaderSearchOptions {
  viewMode: ReaderViewMode;
  hasTranslation: boolean;
  rawParagraphs: string[];
  translatedParagraphs: string[];
  aligned: { raw?: string | null; translated?: string | null }[];
  chapterKey: string;
  enabled: boolean;
}

export function useReaderSearch({
  viewMode,
  hasTranslation,
  rawParagraphs,
  translatedParagraphs,
  aligned,
  chapterKey,
  enabled,
}: UseReaderSearchOptions): ReaderSearchApi {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const targets = useMemo(
    () =>
      buildReaderSearchTargets({
        viewMode,
        hasTranslation,
        rawParagraphs,
        translatedParagraphs,
        aligned,
      }),
    [viewMode, hasTranslation, rawParagraphs, translatedParagraphs, aligned],
  );

  const matches = useMemo(
    () => collectReaderSearchMatches(targets, deferredQuery),
    [targets, deferredQuery],
  );
  const truncated = matches.length >= READER_SEARCH_MATCH_LIMIT;

  useEffect(() => {
    setActiveIndex(0);
  }, [chapterKey, viewMode, deferredQuery]);

  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const openFind = useCallback(() => {
    setOpen(true);
    setFocusRequest((request) => request + 1);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const step = useCallback(
    (delta: number) => {
      setActiveIndex((index) => {
        if (matches.length === 0) return 0;
        return (index + delta + matches.length) % matches.length;
      });
    },
    [matches.length],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  const activeKey = useMemo(() => {
    const match = matches[activeIndex];
    if (!match) return null;
    return `${match.paragraphIndex}:${match.column ?? "none"}:${match.start}:${match.end}`;
  }, [activeIndex, matches]);

  useEffect(() => {
    if (!open || activeKey === null) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(READER_SEARCH_ACTIVE_MARK_ID)
        ?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeKey, open, matches]);

  const highlightsFor = useCallback(
    (paragraphIndex: number, column: ReaderColumn | null) =>
      highlightsForParagraph(matches, activeIndex, paragraphIndex, column),
    [activeIndex, matches],
  );

  return useMemo(
    () => ({
      open,
      query,
      setQuery,
      openFind,
      close,
      focusRequest,
      matchCount: matches.length,
      truncated,
      activeIndex: matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1),
      next,
      previous,
      highlightsFor,
    }),
    [
      open,
      query,
      openFind,
      close,
      focusRequest,
      matches.length,
      truncated,
      activeIndex,
      next,
      previous,
      highlightsFor,
    ],
  );
}
