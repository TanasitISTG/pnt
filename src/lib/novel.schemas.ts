import { z } from "zod";

export const sourceLangSchema = z.enum(["en", "zh"]);
export const targetLangSchema = z.enum(["en", "th"]);
export const coverMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const createNovelSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  originalTitle: z.string().max(500).optional().nullable(),
  author: z.string().max(200).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  sourceLang: sourceLangSchema,
  targetLang: targetLangSchema,
  customPrompt: z.string().max(10000).optional().nullable(),
  chunkSize: z.number().int().min(500).max(10000).optional().default(2000),
  contextTailLength: z.number().int().min(100).max(2000).optional().default(500),
  cover: z.string().max(4_000_000).optional().nullable(), // base64 (~2.7MB file max)
  coverMime: coverMimeSchema.optional().nullable(),
});

export const updateNovelSchema = createNovelSchema.partial().extend({
  novelId: z.string().min(1),
  removeCover: z.boolean().optional(),
});

export const createChapterSchema = z.object({
  novelId: z.string().min(1),
  number: z.number().positive("Chapter number must be positive"),
  title: z.string().min(1, "Title is required").max(500),
  rawContent: z.string().min(1, "Content is required"),
});

export const updateChapterSchema = z.object({
  chapterId: z.string().min(1),
  number: z.number().positive("Chapter number must be positive").optional(),
  title: z.string().min(1).max(500).optional(),
  rawContent: z.string().min(1).optional(),
});

export const updateChapterTranslationSchema = z.object({
  chapterId: z.string().min(1),
  translatedContent: z.string().min(1, "Translation cannot be empty"),
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
