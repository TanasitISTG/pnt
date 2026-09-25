import type { ReaderContentProps, ReaderTranslationStatus } from "./reader-content-types";
import { ReaderEmptyContent } from "./reader-content-empty";
import { ReaderTranslatedContent } from "./reader-content-translated";
import { ReaderUntranslatedContent } from "./reader-content-untranslated";
import { READER_LANGUAGE_NAMES } from "./reader-content-language";

function isFailedTranslation(status: ReaderTranslationStatus | undefined): boolean {
  return status === "error" || status === "cancelled";
}

function ReaderTranslationFailureNotice() {
  return (
    <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="font-medium text-foreground">The last translation attempt did not finish.</p>
      <p className="mt-1 text-caption text-muted-foreground">
        Use chapter actions to retry translation or edit the chapter.
      </p>
    </div>
  );
}

export function ReaderContentView({
  hasTranslation,
  viewMode,
  aligned,
  rawParagraphs,
  translatedParagraphs,
  fontSizePx,
  lineHeight,
  measureRem,
  readerFontClass,
  sourceLang = "zh",
  targetLang = "th",
  isAdmin = false,
  translationStatus = "idle",
  highlightsFor,
  proseRef,
}: ReaderContentProps) {
  const sourceName = READER_LANGUAGE_NAMES[sourceLang];
  const targetName = READER_LANGUAGE_NAMES[targetLang] ?? targetLang;
  const hasReadableText = rawParagraphs.length > 0 || translatedParagraphs.length > 0;

  if (!hasReadableText) {
    return <ReaderEmptyContent />;
  }

  return (
    <div>
      {isAdmin && hasTranslation && isFailedTranslation(translationStatus) ? (
        <ReaderTranslationFailureNotice />
      ) : null}
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
          lineHeight={lineHeight}
          measureRem={measureRem}
          readerFontClass={readerFontClass}
          sourceLang={sourceLang}
          sourceName={sourceName}
          targetLang={targetLang}
          targetName={targetName}
          highlightsFor={highlightsFor}
          proseRef={proseRef}
        />
      ) : (
        <ReaderUntranslatedContent
          rawParagraphs={rawParagraphs}
          fontSizePx={fontSizePx}
          lineHeight={lineHeight}
          measureRem={measureRem}
          readerFontClass={readerFontClass}
          sourceLang={sourceLang}
          highlightsFor={highlightsFor}
          proseRef={proseRef}
        />
      )}
    </div>
  );
}
