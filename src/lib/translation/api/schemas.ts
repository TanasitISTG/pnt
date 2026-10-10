import { z } from "zod";

export const translationStartModeSchema = z.enum(["missing", "overwrite"]);
export type TranslationStartMode = z.infer<typeof translationStartModeSchema>;

export const startTranslationJobSchema = z.object({
  chapterId: z.string().min(1),
  mode: translationStartModeSchema,
});

export const startTranslationJobsSchema = z.object({
  novelId: z.string().min(1),
  chapterIds: z.array(z.string().min(1)).min(1).max(500),
  mode: translationStartModeSchema,
});

export const previewTranslationBatchSchema = z.object({
  novelId: z.string().min(1),
  chapterIds: z.array(z.string().min(1)).min(1).max(500),
  mode: translationStartModeSchema,
});

export const cancelTranslationJobSchema = z.object({
  jobId: z.string().min(1),
});

export const cancelTranslationJobsSchema = z.object({
  novelId: z.string().min(1),
  chapterIds: z.array(z.string().min(1)).min(1).max(500),
});

export const retryTranslationJobSchema = z.object({
  jobId: z.string().min(1),
});

export const translationJobLookupSchema = z.object({
  jobId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
});

export const listActiveJobsSchema = z.object({
  novelId: z.string().min(1),
});

export const getJobsTerminalStatusSchema = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(500),
});
