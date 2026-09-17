import { z } from "zod";

import { coverMimeSchema, createNovelSchema } from "@/lib/content/novel/novel.schemas";
import { relationshipMapSchema } from "@/lib/relationships/schemas";
import { SafeServerError } from "@/lib/server-fn-error";
import { isSupportedLanguagePair } from "@/lib/language-pair";

// Chapter numbers live in a numeric(8, 2) column, so at most six integer digits.
const chapterNumberSchema = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, "Chapter number must be a number with up to two decimals")
  .refine((value) => Number(value) > 0, "Chapter number must be positive");

const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Expected an ISO date string");

const backupChapterSchema = z.object({
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
});

const backupTermSchema = z.object({
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
    message: "Cover MIME type is required when a cover image is present",
    path: ["coverMime"],
  })
  // Chapter numbers compare numerically in the column's unique index, so "1"
  // and "1.00" are the same chapter there.
  .refine(
    (data) =>
      new Set(data.chapters.map((chapter) => Number(chapter.number))).size === data.chapters.length,
    { message: "Backup contains duplicate chapter numbers", path: ["chapters"] },
  )
  .refine(
    (data) =>
      new Set(data.glossaryTerms.map((term) => term.source)).size === data.glossaryTerms.length,
    { message: "Backup contains duplicate glossary sources", path: ["glossaryTerms"] },
  )
  .refine((data) => isSupportedLanguagePair(data.sourceLang, data.targetLang), {
    message: "Backup contains an unsupported language pair",
    path: ["targetLang"],
  });

export const backupSchema = z.object({
  app: z.literal("pnt"),
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  novels: z.array(backupNovelSchema),
});

export type Backup = z.infer<typeof backupSchema>;

function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue?.message ?? "validation failed"}`;
}

/**
 * Restore-time parsing. Zod failures are unhandled by `withSafeHandler` and would
 * surface as a generic message, so report the first issue instead — the admin
 * has to fix the file by hand.
 */
export function parseBackup(value: unknown): Backup {
  const result = backupSchema.safeParse(value);
  if (result.success) return result.data;
  throw new SafeServerError(`Invalid backup file — ${firstIssueMessage(result.error)}`);
}

/**
 * Export-time check that keeps the two directions symmetric: anything the app
 * writes out is something the restore accepts back.
 */
export function assertExportableBackup(value: unknown): Backup {
  const result = backupSchema.safeParse(value);
  if (result.success) return result.data;
  throw new SafeServerError(`Backup export failed validation — ${firstIssueMessage(result.error)}`);
}
