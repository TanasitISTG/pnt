import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { getNovel } from "@/lib/content/novel.functions";
import { getRelationshipMap } from "@/lib/relationships/functions";

export const relationshipMapViewSchema = z.enum(["characters", "relationships"]);
export const relationshipMapStateSchema = z.enum(["all", "active", "inactive"]);
export const relationshipMapManagementSchema = z.enum(["all", "manual", "auto"]);
export const relationshipMapSortSchema = z.enum(["name", "state", "management"]);
export const relationshipMapDirectionSchema = z.enum(["asc", "desc"]);

export const relationshipMapSearchSchema = z.object({
  view: relationshipMapViewSchema.default("characters"),
  q: z.string().trim().max(100).default(""),
  state: relationshipMapStateSchema.default("all"),
  management: relationshipMapManagementSchema.default("all"),
  sort: relationshipMapSortSchema.default("name"),
  dir: relationshipMapDirectionSchema.default("asc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value): value is 10 | 25 | 50 => value === 10 || value === 25 || value === 50, {
      message: "Page size must be 10, 25, or 50",
    })
    .default(25),
});

export type RelationshipMapSearch = z.infer<typeof relationshipMapSearchSchema>;

export const relationshipNovelQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["novel", novelId] as const,
    queryFn: () => getNovel({ data: { novelId } }),
  });

export const relationshipMapQueryOptions = (novelId: string) =>
  queryOptions({
    queryKey: ["relationshipMap", novelId] as const,
    queryFn: () => getRelationshipMap({ data: { novelId } }),
  });
