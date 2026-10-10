import type { Ref } from "react";

import type { ReaderHighlightsLookup } from "./reader-content-types";
import { ReaderProse } from "./reader-content-prose";

interface ReaderUntranslatedContentProps {
  rawParagraphs: string[];
  fontSizePx: number;
  lineHeight: number;
  measureRem: number;
  readerFontClass?: string;
  sourceLang: string;
  highlightsFor?: ReaderHighlightsLookup;
  proseRef?: Ref<HTMLDivElement>;
}

export function ReaderUntranslatedContent({
  rawParagraphs,
  fontSizePx,
  lineHeight,
  measureRem,
  readerFontClass,
  sourceLang,
  highlightsFor,
  proseRef,
}: ReaderUntranslatedContentProps) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-caption italic text-muted-foreground">
        Not translated yet — showing raw text.
      </p>
      <ReaderProse
        paragraphs={rawParagraphs}
        fontSizePx={fontSizePx}
        lineHeight={lineHeight}
        measureRem={measureRem}
        readerFontClass={readerFontClass}
        lang={sourceLang}
        highlightsFor={highlightsFor}
        proseRef={proseRef}
      />
    </div>
  );
}
