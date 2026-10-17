import { useTranslations } from "use-intl";

import { languageName } from "@/lib/i18n/language-name";

import type { ReaderContentProps, ReaderTranslationStatus } from "./reader-content-types";
import { ReaderEmptyContent } from "./reader-content-empty";
import { ReaderTranslatedContent } from "./reader-content-translated";
import { ReaderUntranslatedContent } from "./reader-content-untranslated";

function isFailedTranslation(status: ReaderTranslationStatus | undefined): boolean {
  return status === "error" || status === "cancelled";
}

function ReaderTranslationFailureNotice() {
  const t = useTranslations("reader");
  return (
    <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="font-medium text-foreground">{t("translationFailedTitle")}</p>
      <p className="mt-1 text-caption text-muted-foreground">{t("translationFailedDescription")}</p>
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
  canManage = false,
  translationStatus = "idle",
  highlightsFor,
  proseRef,
}: ReaderContentProps) {
  const t = useTranslations("reader");
  const tRoot = useTranslations();
  const sourceName = languageName(tRoot, sourceLang);
  const targetName = languageName(tRoot, targetLang) ?? targetLang;
  const hasReadableText = rawParagraphs.length > 0 || translatedParagraphs.length > 0;

  if (!hasReadableText) {
    return <ReaderEmptyContent />;
  }

  return (
    <div>
      {canManage && hasTranslation && isFailedTranslation(translationStatus) ? (
        <ReaderTranslationFailureNotice />
      ) : null}
      {viewMode !== "raw" && hasTranslation ? (
        <p className="mb-5 text-caption text-muted-foreground">
          {sourceName ? t("machineTranslatedFrom", { source: sourceName }) : t("machineTranslated")}
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
