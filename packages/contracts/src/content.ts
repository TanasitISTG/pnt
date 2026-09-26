import { z } from "zod";

export const novelIdSchema = z.string().min(1);
export const chapterIdSchema = z.string().min(1);
export const bookmarkIdSchema = z.string().min(1);

const isoDateSchema = z.iso.datetime();
const nullableIsoDateSchema = isoDateSchema.nullable();
const nullableTextSchema = z.string().nullable();
const chapterNumberSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const chapterStatusSchema = z.enum(["raw", "queued", "translating", "translated", "error"]);

const novelMetadataV1Shape = {
  id: novelIdSchema,
  title: z.string(),
  originalTitle: nullableTextSchema,
  author: nullableTextSchema,
  description: nullableTextSchema,
  sourceLang: z.string(),
  targetLang: z.string(),
  publishedAt: nullableIsoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  hasCover: z.boolean(),
};

// Reject extra fields rather than silently projecting privileged service rows.
export const novelListV1Schema = z.strictObject({
  ...novelMetadataV1Shape,
  chapterCount: z.number().int().min(0),
  translatedCount: z.number().int().min(0),
});

export const novelDetailV1Schema = z.strictObject(novelMetadataV1Shape);

export const chapterSummaryV1Schema = z.strictObject({
  id: chapterIdSchema,
  novelId: novelIdSchema,
  number: chapterNumberSchema,
  title: z.string(),
  translatedTitle: nullableTextSchema,
  hasTranslation: z.boolean(),
  status: chapterStatusSchema,
  publishedAt: nullableIsoDateSchema,
  updatedAt: isoDateSchema,
});

export const chapterManifestItemV1Schema = z.strictObject({
  id: chapterIdSchema,
  number: chapterNumberSchema,
  title: z.string(),
  translatedTitle: nullableTextSchema,
});

export const chapterManifestV1Schema = z.array(chapterManifestItemV1Schema);

export const chapterBodyV1Schema = z.strictObject({
  id: chapterIdSchema,
  novelId: novelIdSchema,
  number: chapterNumberSchema,
  title: z.string(),
  translatedTitle: nullableTextSchema,
  rawContent: z.string(),
  translatedContent: nullableTextSchema,
  status: chapterStatusSchema,
  updatedAt: isoDateSchema,
});

export type NovelListV1 = z.infer<typeof novelListV1Schema>;
export type NovelDetailV1 = z.infer<typeof novelDetailV1Schema>;
export type ChapterSummaryV1 = z.infer<typeof chapterSummaryV1Schema>;
export type ChapterManifestItemV1 = z.infer<typeof chapterManifestItemV1Schema>;
export type ChapterBodyV1 = z.infer<typeof chapterBodyV1Schema>;
