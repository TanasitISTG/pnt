import { z } from "zod";

import { coverMimeSchema, createNovelSchema } from "@/lib/content/novel/novel.schemas";
import { encodeMessage } from "@/lib/i18n/message-code";
import { relationshipMapSchema } from "@/lib/relationships/schemas";
import { SafeServerError } from "@/lib/server-fn-error";
import { isSupportedLanguagePair } from "@/lib/language-pair";

// Chapter numbers live in a numeric(8, 2) column, so at most six integer digits.
const chapterNumberSchema = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, encodeMessage("validation.backupChapterNumberFormat"))
  .refine((value) => Number(value) > 0, encodeMessage("validation.chapterNumberPositive"));

const isoDateStringSchema = z
  .string()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    encodeMessage("validation.backupIsoDateRequired"),
  );

export const backupChapterSchema = z
  .object({
    id: z.string(),
    number: chapterNumberSchema,
    title: z.string(),
    translatedTitle: z.string().nullable(),
    rawContent: z.string(),
    translatedContent: z.string().nullable(),
    status: z.enum(["raw", "queued", "translating", "translated", "error"]),
    summary: z.string().nullable(),
    rawCharCount: z.number().int().nonnegative(),
    sourceRevision: z.number().int().nonnegative(),
    translationGeneration: z.number().int().nonnegative(),
    publishedAt: z.string().nullable(),
    // Only the dates the restore consumes are validated; the rest are replaced on import.
    translatedAt: isoDateStringSchema.nullable(),
    editedAt: isoDateStringSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((chapter, context) => {
    const hasTranslatedContent =
      chapter.translatedContent !== null && chapter.translatedContent.trim().length > 0;

    if (chapter.translatedContent !== null && !hasTranslatedContent) {
      context.addIssue({
        code: "custom",
        message: encodeMessage("validation.backupTranslationNullOrNonblank"),
        path: ["translatedContent"],
      });
    }
    if (chapter.status === "translated" && !hasTranslatedContent) {
      context.addIssue({
        code: "custom",
        message: encodeMessage("validation.backupTranslationRequired"),
        path: ["status"],
      });
    }
    if (chapter.status === "raw" && chapter.translatedContent !== null) {
      context.addIssue({
        code: "custom",
        message: encodeMessage("validation.backupRawRequiresNullTranslation"),
        path: ["status"],
      });
    }
    if (chapter.rawCharCount !== chapter.rawContent.length) {
      context.addIssue({
        code: "custom",
        message: encodeMessage("validation.backupRawCountMismatch"),
        path: ["rawCharCount"],
      });
    }
  });

export const backupTermSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  category: z.enum(["character", "place", "skill", "item", "other"]),
  note: z.string().nullable(),
  status: z.enum(["approved", "pending", "rejected"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const backupNovelSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    originalTitle: createNovelSchema.shape.originalTitle.unwrap().unwrap().nullable(),
    author: createNovelSchema.shape.author.unwrap().unwrap().nullable(),
    description: createNovelSchema.shape.description.unwrap().unwrap().nullable(),
    // Bounded like the cover upload path; the route serves these bytes and this
    // content type to guests, so both are constrained to real image media types.
    coverBase64: z.string().max(1_400_000).nullable(),
    coverMime: coverMimeSchema.nullable(),
    sourceLang: z.string(),
    targetLang: z.string(),
    customPrompt: createNovelSchema.shape.customPrompt.unwrap().unwrap().nullable(),
    storySummary: z.string().nullable(),
    relationshipMap: relationshipMapSchema.optional(),
    // Both feed translation run cost directly: a tiny chunk size explodes the
    // step count and an unbounded tail bloats every prompt.
    chunkSize: z.number().int().min(500).max(10000),
    contextTailLength: z.number().int().min(100).max(2000),
    publishedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    chapters: z.array(backupChapterSchema),
    glossaryTerms: z.array(backupTermSchema),
  })
  .refine((data) => !data.coverBase64 || !!data.coverMime, {
    message: encodeMessage("validation.backupCoverMimeRequired"),
    path: ["coverMime"],
  })
  // Chapter numbers compare numerically in the column's unique index, so "1"
  // and "1.00" are the same chapter there.
  .refine(
    (data) =>
      new Set(data.chapters.map((chapter) => Number(chapter.number))).size === data.chapters.length,
    { message: encodeMessage("validation.backupDuplicateChapterNumbers"), path: ["chapters"] },
  )
  .refine(
    (data) =>
      new Set(data.glossaryTerms.map((term) => term.source)).size === data.glossaryTerms.length,
    {
      message: encodeMessage("validation.backupDuplicateGlossarySources"),
      path: ["glossaryTerms"],
    },
  )
  .refine((data) => isSupportedLanguagePair(data.sourceLang, data.targetLang), {
    message: encodeMessage("validation.backupUnsupportedLanguagePair"),
    path: ["targetLang"],
  });

export const backupSchema = z.object({
  app: z.literal("pnt"),
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  novels: z.array(backupNovelSchema),
});

export type Backup = z.infer<typeof backupSchema>;

/**
 * The first issue a backup failed on, as a message code.
 *
 * A Zod message is a code, and a code wrapped in an English sentence is a string no catalog can
 * resolve. So the two travel as a wrapper with a nested message: `{path}` names the field and
 * `{message}` is the rule, which `translateMessage` resolves in turn.
 */
function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return encodeMessage("validation.backupInvalid");
  const path = issue.path.join(".");
  // The field is named as a value and the rule as a nested message, so a reader gets both in
  // their own language. A rule the catalog does not know - a Zod default - travels as the
  // sentence it is, which is why the wrapper resolves only what it can.
  return path
    ? encodeMessage("validation.backupFieldInvalid", { path, message: issue.message })
    : issue.message;
}

/**
 * Restore-time parsing. Zod failures are unhandled by `withSafeHandler` and would
 * surface as a generic message, so report the first issue instead — the admin
 * has to fix the file by hand.
 */
export function parseBackup(value: unknown): Backup {
  const result = backupSchema.safeParse(value);
  if (result.success) return result.data;
  throw new SafeServerError(firstIssueMessage(result.error));
}

/**
 * Export-time check that keeps the two directions symmetric: anything the app
 * writes out is something the restore accepts back.
 */
export function assertExportableBackup(value: unknown): Backup {
  const result = backupSchema.safeParse(value);
  if (result.success) return result.data;
  throw new SafeServerError(firstIssueMessage(result.error));
}
