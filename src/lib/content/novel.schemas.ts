import { z } from "zod";

export const sourceLangSchema = z.enum(["en", "zh"]);
export const targetLangSchema = z.enum(["en", "th"]);
export const coverMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

const baseNovelFields = {
  title: z.string().min(1, "Title is required").max(500),
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
