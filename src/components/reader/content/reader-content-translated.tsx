import type { ReaderHighlightsLookup } from "./reader-content-types";
import {
  ReaderMissingOriginalContent,
  ReaderMissingTranslationContent,
} from "./reader-content-empty";
import { ReaderComparison, ReaderProse } from "./reader-content-prose";

interface ReaderTranslatedContentProps {
  viewMode: "side" | "translated" | "raw";
  aligned: { raw?: string | null; translated?: string | null }[];
  rawParagraphs: string[];
  translatedParagraphs: string[];
  fontSizePx: number;
  lineHeight: number;
  measureRem: number;
  readerFontClass?: string;
  sourceLang: string;
  sourceName?: string;
  targetLang: string;
  targetName: string;
  highlightsFor?: ReaderHighlightsLookup;
}

export function ReaderTranslatedContent({
  viewMode,
  aligned,
  rawParagraphs,
  translatedParagraphs,
  fontSizePx,
  lineHeight,
  measureRem,
  readerFontClass,
  sourceLang,
  sourceName,
  targetLang,
  targetName,
  highlightsFor,
}: ReaderTranslatedContentProps) {
  if (viewMode === "side") {
    return (
      <ReaderComparison
        aligned={aligned}
        fontSizePx={fontSizePx}
        lineHeight={lineHeight}
        measureRem={measureRem}
        readerFontClass={readerFontClass}
        sourceLang={sourceLang}
        sourceName={sourceName}
        targetLang={targetLang}
        targetName={targetName}
        highlightsFor={highlightsFor}
      />
    );
  }

  if (viewMode === "translated") {
    return translatedParagraphs.length > 0 ? (
      <ReaderProse
        paragraphs={translatedParagraphs}
        fontSizePx={fontSizePx}
        lineHeight={lineHeight}
        measureRem={measureRem}
        readerFontClass={readerFontClass}
        lang={targetLang}
        highlightsFor={highlightsFor}
      />
    ) : (
      <ReaderMissingTranslationContent />
    );
  }

  return rawParagraphs.length > 0 ? (
    <ReaderProse
      paragraphs={rawParagraphs}
      fontSizePx={fontSizePx}
      lineHeight={lineHeight}
      measureRem={measureRem}
      readerFontClass={readerFontClass}
      lang={sourceLang}
      highlightsFor={highlightsFor}
    />
  ) : (
    <ReaderMissingOriginalContent />
  );
}
