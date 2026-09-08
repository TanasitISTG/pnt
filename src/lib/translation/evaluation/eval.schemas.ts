import { z } from "zod";

export const EVAL_SELECTOR_ERROR =
  "Use first3, all, or chapter numbers and ranges such as 1,1.5,5-8.";

const MAX_SELECTOR_LENGTH = 512;
const MIN_CHAPTER_HUNDREDTHS = 1;
const MAX_CHAPTER_HUNDREDTHS = 99_999_999;

export type EvalRange = { from: string; to: string };

export type EvalSelection =
  | { mode: "first3" }
  | { mode: "all" }
  | { mode: "ranges"; ranges: EvalRange[] };

type NumericRange = { from: number; to: number };

function invalidSelector(): never {
  throw new Error(EVAL_SELECTOR_ERROR);
}

function parseChapterNumber(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return invalidSelector();

  const whole = Number(match[1]);
  const fraction = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const hundredths = whole * 100 + fraction;
  if (
    !Number.isSafeInteger(whole) ||
    !Number.isSafeInteger(hundredths) ||
    hundredths < MIN_CHAPTER_HUNDREDTHS ||
    hundredths > MAX_CHAPTER_HUNDREDTHS
  ) {
    return invalidSelector();
  }
  return hundredths;
}

function formatChapterNumber(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = hundredths % 100;
  if (fraction === 0) return String(whole);
  if (fraction % 10 === 0) return `${whole}.${fraction / 10}`;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

function parseRangePart(part: string): NumericRange {
  const pieces = part.split("-");
  if (pieces.length === 1) {
    const number = parseChapterNumber(pieces[0].trim());
    return { from: number, to: number };
  }
  if (pieces.length !== 2) return invalidSelector();

  const from = parseChapterNumber(pieces[0].trim());
  const to = parseChapterNumber(pieces[1].trim());
  if (to < from) return invalidSelector();
  return { from, to };
}

export function parseEvalSelection(selector: string): EvalSelection {
  if (selector.length > MAX_SELECTOR_LENGTH) return invalidSelector();

  const normalized = selector.trim();
  if (!normalized) return invalidSelector();

  const token = normalized.toLowerCase();
  if (token === "first3") return { mode: "first3" };
  if (token === "all") return { mode: "all" };

  const parts = normalized.split(",");
  if (parts.some((part) => part.trim().length === 0)) return invalidSelector();

  const ranges = parts.map((part) => parseRangePart(part));
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);

  const merged: NumericRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }

  return {
    mode: "ranges",
    ranges: merged.map((range) => ({
      from: formatChapterNumber(range.from),
      to: formatChapterNumber(range.to),
    })),
  };
}

export const evalSelectorSchema = z
  .string()
  .superRefine((selector, context) => {
    if (selector.length > MAX_SELECTOR_LENGTH || selector.trim().length === 0) {
      context.addIssue({ code: "custom", message: EVAL_SELECTOR_ERROR });
      return;
    }
    try {
      parseEvalSelection(selector);
    } catch {
      context.addIssue({ code: "custom", message: EVAL_SELECTOR_ERROR });
    }
  })
  .transform((selector) => selector.trim());

export const startTranslationEvalSchema = z.object({
  novelId: z.string().min(1),
  chapterSelector: evalSelectorSchema.default("first3"),
});

export const listTranslationEvalReportsSchema = z.object({
  novelId: z.string().min(1),
});

export const evalReportFilterSchema = z.enum(["attention", "all", "untranslated"]);

export const evalPageSizeSchema = z.coerce
  .number()
  .int()
  .refine((value): value is 10 | 25 | 50 => value === 10 || value === 25 || value === 50, {
    message: "Page size must be 10, 25, or 50",
  });

export const getTranslationEvalReportSchema = z.object({
  novelId: z.string().min(1),
  reportId: z.string().min(1),
  filter: evalReportFilterSchema.default("attention"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: evalPageSizeSchema.default(25),
});

export const evalReviewSearchSchema = z.object({
  reviewReport: z.string().min(1).optional(),
  reviewFilter: evalReportFilterSchema.default("attention"),
  reviewPage: z.coerce.number().int().positive().default(1),
  reviewPageSize: evalPageSizeSchema.default(25),
});

export const evalReportStatusSchema = z.enum(["pending", "running", "done", "error"]);
export const evalMissingGlossaryTermSchema = z.object({
  source: z.string(),
  target: z.string(),
});

const storedChapterStatusSchema = z.enum(["raw", "queued", "translating", "translated", "error"]);

const residualExampleSchema = z.string().refine((value) => {
  let length = 0;
  for (let offset = 0; offset < value.length; offset++) {
    const codePoint = value.codePointAt(offset);
    if (codePoint !== undefined && codePoint > 0xffff) offset++;
    if (++length > 120) return false;
  }
  return true;
}, "Residual examples must contain at most 120 Unicode code points");

const storedChapterNumberSchema = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (value) =>
      /^\d{1,6}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0 && Number(value) <= 999999.99,
  );

const evalStoredResultFields = {
  chapterId: z.string().min(1),
  chapterNumber: storedChapterNumberSchema,
  chapterTitle: z.string(),
  status: storedChapterStatusSchema,
  residualScriptLetters: z.number().int().nonnegative(),
  markerMismatches: z.number().int().nonnegative(),
  matchedGlossaryTerms: z.number().int().nonnegative(),
  adheredGlossaryTerms: z.number().int().nonnegative(),
  glossaryAdherencePercent: z.number().int().min(0).max(100).nullable(),
};

export const legacyEvalStoredResultSchema = z
  .object(evalStoredResultFields)
  .strict()
  .refine(
    (row) =>
      row.adheredGlossaryTerms <= row.matchedGlossaryTerms &&
      row.glossaryAdherencePercent ===
        (row.matchedGlossaryTerms > 0
          ? Math.round((row.adheredGlossaryTerms / row.matchedGlossaryTerms) * 100)
          : null),
    "Inconsistent legacy evaluation metrics",
  );

export const evalStoredResultSchema = z
  .object({
    ...evalStoredResultFields,
    evaluated: z.boolean(),
    chapterUpdatedAt: z.iso.datetime(),
    rawParagraphCount: z.number().int().nonnegative(),
    translatedParagraphCount: z.number().int().nonnegative(),
    missingGlossaryTerms: z.array(evalMissingGlossaryTermSchema).max(5),
    residualSpanCount: z.number().int().nonnegative(),
    residualExamples: z.array(residualExampleSchema).max(3),
  })
  .strict()
  .refine((row) => {
    if (row.adheredGlossaryTerms > row.matchedGlossaryTerms) return false;
    if (row.residualExamples.length !== Math.min(row.residualSpanCount, 3)) return false;
    if (
      row.missingGlossaryTerms.length !==
      Math.min(row.matchedGlossaryTerms - row.adheredGlossaryTerms, 5)
    )
      return false;
    if (
      row.glossaryAdherencePercent !==
      (row.matchedGlossaryTerms > 0
        ? Math.round((row.adheredGlossaryTerms / row.matchedGlossaryTerms) * 100)
        : null)
    )
      return false;
    return row.evaluated
      ? row.markerMismatches === Math.abs(row.rawParagraphCount - row.translatedParagraphCount)
      : row.markerMismatches === 0 &&
          row.matchedGlossaryTerms === 0 &&
          row.adheredGlossaryTerms === 0 &&
          row.residualScriptLetters === 0 &&
          row.residualSpanCount === 0 &&
          row.translatedParagraphCount === 0;
  }, "Inconsistent stored evaluation metrics");

const evalSummaryFields = {
  chapterCount: z.number().int().nonnegative(),
  residualScriptLetters: z.number().int().nonnegative(),
  markerMismatches: z.number().int().nonnegative(),
  matchedGlossaryTerms: z.number().int().nonnegative(),
  adheredGlossaryTerms: z.number().int().nonnegative(),
};

export const legacyEvalSummarySchema = z.object(evalSummaryFields).strict();

export const evalSummarySchema = z
  .object({
    ...evalSummaryFields,
    version: z.literal(1),
    languagePair: z.string().min(1),
    contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    evaluatedChapterCount: z.number().int().nonnegative(),
    skippedChapterCount: z.number().int().nonnegative(),
    attentionChapterCount: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (summary) =>
      summary.evaluatedChapterCount + summary.skippedChapterCount === summary.chapterCount &&
      summary.attentionChapterCount <= summary.evaluatedChapterCount &&
      summary.adheredGlossaryTerms <= summary.matchedGlossaryTerms,
    "Inconsistent stored evaluation totals",
  );

export type StartTranslationEvalInput = z.input<typeof startTranslationEvalSchema>;
export type StartTranslationEvalData = z.infer<typeof startTranslationEvalSchema>;
export type ListTranslationEvalReportsInput = z.infer<typeof listTranslationEvalReportsSchema>;
export type GetTranslationEvalReportInput = z.infer<typeof getTranslationEvalReportSchema>;
export type EvalReportFilter = z.infer<typeof evalReportFilterSchema>;
export type EvalPageSize = z.infer<typeof evalPageSizeSchema>;
export type EvalReviewSearch = z.infer<typeof evalReviewSearchSchema>;
export type EvalStoredResult = z.infer<typeof evalStoredResultSchema>;
export type LegacyEvalStoredResult = z.infer<typeof legacyEvalStoredResultSchema>;
export type EvalSummary = z.infer<typeof evalSummarySchema>;
export type LegacyEvalSummary = z.infer<typeof legacyEvalSummarySchema>;

export const evalSnapshotStateSchema = z.enum(["current", "changed", "deleted", "unknown"]);

export const evalReviewRowSchema = z.object({
  chapterId: z.string().min(1),
  chapterNumber: z.string(),
  chapterTitle: z.string(),
  status: z.string(),
  residualScriptLetters: z.number().int().nonnegative(),
  markerMismatches: z.number().int().nonnegative(),
  matchedGlossaryTerms: z.number().int().nonnegative(),
  adheredGlossaryTerms: z.number().int().nonnegative(),
  glossaryAdherencePercent: z.number().int().min(0).max(100).nullable(),
  evaluated: z.boolean().nullable(),
  chapterUpdatedAt: z.string().nullable(),
  rawParagraphCount: z.number().int().nonnegative().nullable(),
  translatedParagraphCount: z.number().int().nonnegative().nullable(),
  missingGlossaryTerms: z.array(evalMissingGlossaryTermSchema).nullable(),
  residualSpanCount: z.number().int().nonnegative().nullable(),
  residualExamples: z.array(residualExampleSchema).nullable(),
  snapshotState: evalSnapshotStateSchema,
});

export type EvalReviewRow = z.infer<typeof evalReviewRowSchema>;

const evalTimestampSchema = z.date();

export const evalReportMetaSchema = z.object({
  languagePair: z.string(),
  evaluatedChapterCount: z.number().int().nonnegative(),
  skippedChapterCount: z.number().int().nonnegative(),
  attentionChapterCount: z.number().int().nonnegative(),
});

export const evalReportSummarySchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  status: evalReportStatusSchema,
  chapterSelector: z.string(),
  chapterCount: z.number().int().nonnegative(),
  residualScriptLetters: z.number().int().nonnegative(),
  markerMismatches: z.number().int().nonnegative(),
  matchedGlossaryTerms: z.number().int().nonnegative(),
  adheredGlossaryTerms: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: evalTimestampSchema,
  updatedAt: evalTimestampSchema,
  completedAt: evalTimestampSchema.nullable(),
  meta: evalReportMetaSchema.nullable(),
});

export type EvalReportSummary = z.infer<typeof evalReportSummarySchema>;

export const evalReportDetailSchema = z.object({
  report: evalReportSummarySchema,
  detailsState: z.enum(["ready", "pending", "unavailable"]),
  rows: z.array(evalReviewRowSchema),
  rowCount: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.union([z.literal(10), z.literal(25), z.literal(50)]),
  contextChanged: z.boolean().nullable(),
});

export type EvalReportDetail = z.infer<typeof evalReportDetailSchema>;
