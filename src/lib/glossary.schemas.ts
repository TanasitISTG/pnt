import { z } from "zod";

export const termCategorySchema = z.enum([
  "character",
  "place",
  "skill",
  "item",
  "other",
]);

export const termStatusSchema = z.enum(["approved", "pending"]);

export const listTermsSchema = z.object({
  novelId: z.string().min(1),
  search: z.string().optional(),
  category: z.union([termCategorySchema, z.literal("all")]).optional(),
  status: z.union([termStatusSchema, z.literal("all")]).optional(),
});

export const createTermSchema = z.object({
  novelId: z.string().min(1),
  source: z.string().min(1, "Source term is required").max(500),
  target: z.string().min(1, "Target term is required").max(500),
  category: termCategorySchema.default("other"),
  note: z.string().max(1000).optional().nullable(),
  status: termStatusSchema.optional().default("approved"),
});

export const updateTermSchema = z.object({
  termId: z.string().min(1),
  source: z.string().min(1).max(500).optional(),
  target: z.string().min(1).max(500).optional(),
  category: termCategorySchema.optional(),
  note: z.string().max(1000).optional().nullable(),
  status: termStatusSchema.optional(),
});

export const deleteTermSchema = z.object({
  termId: z.string().min(1),
});

export const bulkImportTermsSchema = z.object({
  novelId: z.string().min(1),
  tsv: z.string().min(1, "TSV content is required"),
});

export const approveTermSchema = z.object({
  termId: z.string().min(1),
});

export const rejectTermSchema = z.object({
  termId: z.string().min(1),
});
