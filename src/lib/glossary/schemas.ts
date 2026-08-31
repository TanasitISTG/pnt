import { z } from "zod";

export const termCategorySchema = z.enum(["character", "place", "skill", "item", "other"]);

export const termStatusSchema = z.enum(["approved", "pending", "rejected"]);

export const glossaryListSortSchema = z.enum(["source", "target", "category", "status"]);

export const glossaryListDirectionSchema = z.enum(["asc", "desc"]);

export const glossaryListSearchSchema = z.object({
  q: z.string().trim().max(100).default(""),
  category: z.union([termCategorySchema, z.literal("all")]).default("all"),
  status: z.union([termStatusSchema, z.literal("all")]).default("approved"),
  sort: glossaryListSortSchema.default("source"),
  dir: glossaryListDirectionSchema.default("asc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value): value is 10 | 25 | 50 => value === 10 || value === 25 || value === 50, {
      message: "Page size must be 10, 25, or 50",
    })
    .default(25),
});

export const listTermsSchema = glossaryListSearchSchema.extend({
  novelId: z.string().min(1),
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
  applyToChapters: z.boolean().optional(),
});

export const previewTermReplacementSchema = z.object({
  novelId: z.string().min(1),
  oldTarget: z.string().min(1).max(500),
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

export type TermCategory = z.infer<typeof termCategorySchema>;
export type TermStatus = z.infer<typeof termStatusSchema>;
export type CreateTermInput = z.input<typeof createTermSchema>;
export type UpdateTermInput = z.input<typeof updateTermSchema>;
export type GlossaryListSearch = z.infer<typeof glossaryListSearchSchema>;
export type GlossaryListInput = z.infer<typeof listTermsSchema>;
export type GlossaryListPageSize = GlossaryListSearch["pageSize"];
export type GlossaryListRow = {
  id: string;
  source: string;
  target: string;
  category: TermCategory;
  note: string | null;
  status: TermStatus;
};
export type GlossaryListPage = {
  rows: GlossaryListRow[];
  rowCount: number;
  page: number;
  pageSize: GlossaryListPageSize;
};
