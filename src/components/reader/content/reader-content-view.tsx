import { Button } from "@/components/ui/button";
import type { ReaderContentProps, ReaderTranslationStatus } from "./reader-content-types";
import { ReaderEmptyContent } from "./reader-content-empty";
import { ReaderTranslatedContent } from "./reader-content-translated";
import { ReaderUntranslatedContent } from "./reader-content-untranslated";
import { READER_LANGUAGE_NAMES } from "./reader-content-language";

function isFailedTranslation(status: ReaderTranslationStatus | undefined): boolean {
  return status === "error" || status === "cancelled";
}

function ReaderTranslationRecovery({
  onTranslateRequest,
  onEditRequest,
}: {
  onTranslateRequest: () => void;
  onEditRequest?: () => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">The last translation attempt did not finish.</p>
        <p className="mt-1 text-caption text-muted-foreground">
          Retry to replace the current translation, or edit the chapter manually.
        </p>
      </div>
      <Button type="button" onClick={onTranslateRequest}>
        Retry translation
      </Button>
      {onEditRequest ? (
        <Button type="button" variant="outline" onClick={onEditRequest}>
          Edit chapter
        </Button>
      ) : null}
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
  jobRunning = false,
  highlightsFor,
  onTranslateRequest,
  onEditRequest,
}: ReaderContentProps) {
  const sourceName = READER_LANGUAGE_NAMES[sourceLang];
  const targetName = READER_LANGUAGE_NAMES[targetLang] ?? targetLang;
  const hasReadableText = rawParagraphs.length > 0 || translatedParagraphs.length > 0;

  if (!hasReadableText) {
    return <ReaderEmptyContent isAdmin={isAdmin} onEditRequest={onEditRequest} />;
  }

  return (
    <div>
      {isAdmin && hasTranslation && isFailedTranslation(translationStatus) && onTranslateRequest ? (
        <ReaderTranslationRecovery
          onTranslateRequest={onTranslateRequest}
          onEditRequest={onEditRequest}
        />
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
          isAdmin={isAdmin}
          translationStatus={translationStatus}
          jobRunning={jobRunning}
          onTranslateRequest={onTranslateRequest}
          onEditRequest={onEditRequest}
        />
      )}
    </div>
  );
}
