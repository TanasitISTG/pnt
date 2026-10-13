import { z } from "zod";

/**
 * The chapter workspace's own search: filtering the row the owner is looking for. Publishing
 * state, review state and the rest are separate destinations now, so they are separate URLs
 * rather than flags on one page.
 */
export const chapterWorkspaceSearchSchema = z.object({
  chapterQuery: z.string().optional().catch(undefined),
});

export type ChapterWorkspaceSearch = z.infer<typeof chapterWorkspaceSearchSchema>;
