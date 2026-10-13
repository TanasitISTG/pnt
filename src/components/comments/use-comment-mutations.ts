import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { createComment, deleteComment, updateComment } from "@/lib/comments/functions";
import { createCommentReport } from "@/lib/reports/functions";
import type { ReportReason } from "@/lib/reports/reasons";

/**
 * Everything a reader can do to a chapter's discussion, with the cache rule in one place:
 * every write invalidates the chapter's comment key, because each one can move a reply
 * count, a `viewerReported` flag, or a tombstone that other rows render around.
 *
 * Posting and editing report no success toast - the comment appearing, or changing, is
 * the feedback. Deletion and filing a report do, because neither leaves a visible trace
 * in the list.
 */
export function useCommentMutations(chapterId: string) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["chapterComments", chapterId] });

  const post = useMutation({
    mutationFn: (input: { body: string; parentId?: string }) =>
      createComment({
        data: { chapterId, body: input.body, parentId: input.parentId },
      }),
    onSuccess: () => void invalidate(),
  });

  const edit = useMutation({
    mutationFn: (input: { commentId: string; body: string }) => updateComment({ data: input }),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => deleteComment({ data: { commentId } }),
    onSuccess: () => {
      toast.success("Comment deleted.");
      void invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That comment could not be deleted"),
  });

  const report = useMutation({
    mutationFn: (input: { commentId: string; reason: ReportReason; details?: string }) =>
      createCommentReport({ data: input }),
    onSuccess: () => {
      toast.success("Report sent. An operator will review it.");
      void invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "That report did not go through"),
  });

  return { post, edit, remove, report };
}
