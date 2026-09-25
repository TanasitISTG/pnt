import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { READER_SEARCH_ACTIVE_MARK_ID, type ReaderParagraphHighlights } from "@/lib/reader/search";

export interface RenderParagraphOptions {
  text: string;
  key: React.Key;
  readerFontClass?: string;
  dimmed?: boolean;
  lang?: string;
  id?: string;
  lineHeight: number;
  highlights?: ReaderParagraphHighlights;
}

function renderHighlightedText(text: string, highlights: ReaderParagraphHighlights): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  highlights.ranges.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    const active =
      highlights.activeRange !== null &&
      highlights.activeRange.start === range.start &&
      highlights.activeRange.end === range.end;
    parts.push(
      <mark
        key={`${range.start}-${range.end}-${index}`}
        id={active ? READER_SEARCH_ACTIVE_MARK_ID : undefined}
        className={cn("rounded-sm text-inherit", active ? "bg-primary/30" : "bg-primary/15")}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function renderParagraph({
  text,
  key,
  readerFontClass,
  dimmed = false,
  lang,
  id,
  lineHeight,
  highlights,
}: RenderParagraphOptions) {
  return (
    <p
      id={id}
      key={key}
      lang={lang}
      className={cn(
        "scroll-mt-20 whitespace-pre-wrap break-words",
        dimmed ? "text-muted-foreground" : "text-foreground",
        readerFontClass,
      )}
      style={{
        lineHeight,
        overflowWrap: "anywhere",
        contentVisibility: "auto",
        containIntrinsicSize: "auto 6rem",
      }}
    >
      {highlights && highlights.ranges.length > 0 ? renderHighlightedText(text, highlights) : text}
    </p>
  );
}
