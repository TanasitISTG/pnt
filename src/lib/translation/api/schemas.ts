import { z } from "zod";

export const startTranslationJobSchema = z.object({
  chapterId: z.string().min(1),
});

export const startTranslationJobsSchema = z.object({
  novelId: z.string().min(1),
  chapterIds: z.array(z.string().min(1)).min(1).max(500),
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

export const listActiveJobsSchema = z.object({
  novelId: z.string().min(1),
});

export const getJobsTerminalStatusSchema = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(500),
});
