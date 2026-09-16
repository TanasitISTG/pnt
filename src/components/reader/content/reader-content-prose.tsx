import type { ReaderHighlightsLookup } from "./reader-content-types";
import {
  createReaderParagraphEntries,
  createReaderParagraphPairEntries,
} from "./reader-content-keys";
import { renderParagraph } from "./render-paragraph";

interface ReaderProseProps {
  paragraphs: string[];
  fontSizePx: number;
  lineHeight: number;
  measureRem: number;
  readerFontClass?: string;
  lang: string;
  dimmed?: boolean;
  highlightsFor?: ReaderHighlightsLookup;
}

export function ReaderProse({
  paragraphs,
  fontSizePx,
  lineHeight,
  measureRem,
  readerFontClass,
  lang,
  dimmed = false,
  highlightsFor,
}: ReaderProseProps) {
  const entries = createReaderParagraphEntries(paragraphs);

  return (
    <div
      className="mx-auto flex w-full flex-col gap-5"
      style={{ fontSize: fontSizePx, maxWidth: `${measureRem}rem` }}
    >
      {entries.map(({ key, paragraph }, index) =>
        renderParagraph({
          text: paragraph,
          key,
          readerFontClass,
          dimmed,
          lang,
          id: `reader-paragraph-${index + 1}`,
          lineHeight,
          highlights: highlightsFor?.(index, null),
        }),
      )}
    </div>
  );
}

interface ReaderComparisonProps {
  aligned: { raw?: string | null; translated?: string | null }[];
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

export function ReaderComparison({
  aligned,
  fontSizePx,
  lineHeight,
  measureRem,
  readerFontClass,
  sourceLang,
  sourceName,
  targetLang,
  targetName,
  highlightsFor,
}: ReaderComparisonProps) {
  const entries = createReaderParagraphPairEntries(aligned);
  return (
    <div
      className="mx-auto flex w-full flex-col gap-5"
      style={{ fontSize: fontSizePx, maxWidth: `${measureRem}rem` }}
    >
      {entries.map(({ key, pair }, index) => (
        <div
          key={key}
          id={`reader-pair-${index + 1}`}
          className="scroll-mt-20 grid gap-4 border-b border-border pb-5 last:border-b-0 md:grid-cols-2 md:gap-8 md:pb-0"
        >
          <div className="min-w-0">
            <p className="mb-2 text-caption font-medium text-muted-foreground">
              {sourceName ?? sourceLang}
            </p>
            {pair.raw
              ? renderParagraph({
                  text: pair.raw,
                  key: `${key}-raw`,
                  readerFontClass,
                  dimmed: true,
                  lang: sourceLang,
                  id: `reader-paragraph-${index + 1}-raw`,
                  lineHeight,
                  highlights: highlightsFor?.(index, "raw"),
                })
              : null}
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-caption font-medium text-muted-foreground">{targetName}</p>
            {pair.translated
              ? renderParagraph({
                  text: pair.translated,
                  key: `${key}-translated`,
                  readerFontClass,
                  dimmed: false,
                  lang: targetLang,
                  id: `reader-paragraph-${index + 1}-translated`,
                  lineHeight,
                  highlights: highlightsFor?.(index, "translated"),
                })
              : null}
          </div>
        </div>
      ))}
    </div>
  );
}
