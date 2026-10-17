import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { createComment, deleteComment, updateComment } from "@/lib/comments/functions";
import { translateServerError } from "@/lib/i18n/server-error";
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
  const t = useTranslations("comments");
  // A report is filed from three surfaces (a comment, a review, a novel) and its two sentences live
  // once, in the namespace that owns reporting.
  const tReports = useTranslations("reports");
  // One root translator: a message code carries its own namespace, so a failure from the server
  // resolves without this hook knowing which namespace it came from.
  const tRoot = useTranslations();
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
      toast.success(t("deleted"));
      void invalidate();
    },
    onError: (error: unknown) => toast.error(translateServerError(error, tRoot, t("deleteFailed"))),
  });

  const report = useMutation({
    mutationFn: (input: { commentId: string; reason: ReportReason; details?: string }) =>
      createCommentReport({ data: input }),
    onSuccess: () => {
      toast.success(tReports("sent"));
      void invalidate();
    },
    onError: (error: unknown) =>
      toast.error(translateServerError(error, tRoot, tReports("failed"))),
  });

  return { post, edit, remove, report };
}
