import { z } from "zod";

import { isSupportedLanguagePair } from "@/lib/language-pair";

export const sourceLangSchema = z.enum(["en", "zh"]);
export const targetLangSchema = z.enum(["en", "th"]);
export const coverMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
export const chapterNumberSchema = z
  .number()
  .positive("Chapter number must be positive")
  .max(999_999.99, "Chapter number must be at most 999999.99")
  .multipleOf(0.01, "Chapter number must have at most two decimal places");

const baseNovelFields = {
  title: z
    .string()
    .min(1, "Title is required")
    .max(500)
    .refine((value) => value.length === 0 || value.trim().length > 0, "Title is required"),
  originalTitle: z.string().max(500).optional().nullable(),
  author: z.string().max(200).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  sourceLang: sourceLangSchema,
  targetLang: targetLangSchema,
  customPrompt: z.string().max(10000).optional().nullable(),
  chunkSize: z.number().int().min(500).max(10000).optional().default(4000),
  contextTailLength: z.number().int().min(100).max(2000).optional().default(500),
  cover: z.string().max(1_400_000).optional().nullable(), // base64 (~1MB file max)
  coverMime: coverMimeSchema.optional().nullable(),
};

export const createNovelSchema = z
  .object(baseNovelFields)
  .refine((data) => !data.cover || !!data.coverMime, {
    message: "Cover MIME type is required when cover image is provided",
    path: ["coverMime"],
  })
  .refine((data) => isSupportedLanguagePair(data.sourceLang, data.targetLang), {
    message: "Unsupported language pair — use EN→TH, ZH→EN, or ZH→TH",
    path: ["targetLang"],
  });

export const updateNovelSchema = z
  .object(baseNovelFields)
  .partial()
  .extend({
    novelId: z.string().min(1),
    removeCover: z.boolean().optional(),
  })
  .refine((data) => !data.cover || !!data.coverMime, {
    message: "Cover MIME type is required when cover image is provided",
    path: ["coverMime"],
  });

export const createChapterSchema = z.object({
  novelId: z.string().min(1),
  number: chapterNumberSchema,
  title: z
    .string()
    .min(1, "Title is required")
    .max(500)
    .refine((value) => value.length === 0 || value.trim().length > 0, "Title is required"),
  rawContent: z
    .string()
    .min(1, "Content is required")
    .refine((value) => value.length === 0 || value.trim().length > 0, "Content is required"),
});

export const updateChapterSchema = z.object({
  chapterId: z.string().min(1),
  number: chapterNumberSchema.optional(),
  title: z
    .string()
    .min(1)
    .max(500)
    .refine((value) => value.length === 0 || value.trim().length > 0, "Title is required")
    .optional(),
  rawContent: z
    .string()
    .min(1)
    .refine((value) => value.length === 0 || value.trim().length > 0, "Content is required")
    .optional(),
});

export const updateChapterTranslationSchema = z.object({
  chapterId: z.string().min(1),
  translatedContent: z.string().min(1, "Translation cannot be empty"),
});
export const editChapterSchema = z
  .object({
    chapterId: z.string().min(1),
    title: z
      .string()
      .max(500)
      .refine((value) => value.trim().length > 0, "Source title is required")
      .optional(),
    translatedTitle: z.string().max(500).nullable().optional(),
    rawContent: z
      .string()
      .refine((value) => value.trim().length > 0, "Source content is required")
      .optional(),
    translatedContent: z
      .string()
      .refine((value) => value.trim().length > 0, "Translation cannot be empty")
      .nullable()
      .optional(),
    sourceChangePolicy: z.enum(["keep", "clear"]).optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.translatedTitle !== undefined ||
      data.rawContent !== undefined ||
      data.translatedContent !== undefined,
    { message: "At least one chapter field is required", path: ["chapterId"] },
  );

export const reorderChaptersSchema = z
  .object({
    novelId: z.string().min(1),
    chapterIds: z.array(z.string().min(1)).min(1),
  })
  .refine((data) => new Set(data.chapterIds).size === data.chapterIds.length, {
    message: "Chapter IDs must be unique",
    path: ["chapterIds"],
  });

// publishedAt: null = unpublish (draft), any date = live at that time (past = now, future = scheduled)
export const setNovelPublishedSchema = z.object({
  novelId: z.string().min(1),
  publishedAt: z.coerce.date().nullable(),
});

export const setChapterPublishedSchema = z.object({
  chapterId: z.string().min(1),
  publishedAt: z.coerce.date().nullable(),
});

export type CreateNovelInput = z.input<typeof createNovelSchema>;
export type UpdateNovelInput = z.input<typeof updateNovelSchema>;
export type CreateChapterInput = z.input<typeof createChapterSchema>;
export type UpdateChapterInput = z.input<typeof updateChapterSchema>;
export type EditChapterInput = z.input<typeof editChapterSchema>;
export type ReorderChaptersInput = z.input<typeof reorderChaptersSchema>;
