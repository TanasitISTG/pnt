import { z } from "zod";

export const startTranslationJobSchema = z.object({
  chapterId: z.string().min(1),
});

export const tickTranslationJobSchema = z.object({
  jobId: z.string().min(1),
});

export const cancelTranslationJobSchema = z.object({
  jobId: z.string().min(1),
});

export const retryTranslationJobSchema = z.object({
  jobId: z.string().min(1),
});

export const getJobStatusSchema = z.object({
  jobId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
});
