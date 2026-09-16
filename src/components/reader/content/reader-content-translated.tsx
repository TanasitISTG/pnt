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
  readerFontClass?: string;
  sourceLang: string;
  sourceName?: string;
  targetLang: string;
  targetName: string;
}

export function ReaderTranslatedContent({
  viewMode,
  aligned,
  rawParagraphs,
  translatedParagraphs,
  fontSizePx,
  readerFontClass,
  sourceLang,
  sourceName,
  targetLang,
  targetName,
}: ReaderTranslatedContentProps) {
  if (viewMode === "side") {
    return (
      <ReaderComparison
        aligned={aligned}
        fontSizePx={fontSizePx}
        readerFontClass={readerFontClass}
        sourceLang={sourceLang}
        sourceName={sourceName}
        targetLang={targetLang}
        targetName={targetName}
      />
    );
  }

  if (viewMode === "translated") {
    return translatedParagraphs.length > 0 ? (
      <ReaderProse
        paragraphs={translatedParagraphs}
        fontSizePx={fontSizePx}
        readerFontClass={readerFontClass}
        lang={targetLang}
      />
    ) : (
      <ReaderMissingTranslationContent />
    );
  }

  return rawParagraphs.length > 0 ? (
    <ReaderProse
      paragraphs={rawParagraphs}
      fontSizePx={fontSizePx}
      readerFontClass={readerFontClass}
      lang={sourceLang}
    />
  ) : (
    <ReaderMissingOriginalContent />
  );
}
