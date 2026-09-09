import type { ReaderContentProps } from "./reader-content-types";
import { ReaderEmptyContent } from "./reader-content-empty";
import { ReaderTranslatedContent } from "./reader-content-translated";
import { ReaderUntranslatedContent } from "./reader-content-untranslated";
import { READER_LANGUAGE_NAMES } from "./reader-content-language";

export function ReaderContentView({
  hasTranslation,
  viewMode,
  aligned,
  rawParagraphs,
  translatedParagraphs,
  fontSizePx,
  readerFontClass,
  sourceLang = "zh",
  targetLang = "th",
}: ReaderContentProps) {
  const sourceName = READER_LANGUAGE_NAMES[sourceLang];
  const targetName = READER_LANGUAGE_NAMES[targetLang] ?? targetLang;
  const hasReadableText = rawParagraphs.length > 0 || translatedParagraphs.length > 0;

  if (!hasReadableText) return <ReaderEmptyContent />;

  return (
    <div>
      {viewMode !== "raw" && hasTranslation ? (
        <p className="mb-5 text-caption text-muted-foreground">
          {sourceName
            ? `Machine-translated from ${sourceName}. May contain inaccuracies.`
            : "Machine-translated. May contain inaccuracies."}
        </p>
      ) : null}
      {hasTranslation ? (
        <ReaderTranslatedContent
          viewMode={viewMode}
          aligned={aligned}
          rawParagraphs={rawParagraphs}
          translatedParagraphs={translatedParagraphs}
          fontSizePx={fontSizePx}
          readerFontClass={readerFontClass}
          sourceLang={sourceLang}
          sourceName={sourceName}
          targetLang={targetLang}
          targetName={targetName}
        />
      ) : (
        <ReaderUntranslatedContent
          rawParagraphs={rawParagraphs}
          fontSizePx={fontSizePx}
          readerFontClass={readerFontClass}
          sourceLang={sourceLang}
        />
      )}
    </div>
  );
}
