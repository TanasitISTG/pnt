import { z } from "zod";

import { evalReviewSearchSchema } from "@/lib/translation/evaluation/eval.schemas";

export const novelDetailSearchSchema = evalReviewSearchSchema.extend({
  section: z.enum(["chapters", "add", "quality"]).optional().catch(undefined),
  chapterQuery: z.string().optional().catch(undefined),
});

export type NovelDetailSearch = z.infer<typeof novelDetailSearchSchema>;
export type DetailSection = "chapters" | "add" | "quality";
