import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

import { translateServerError } from "@/lib/i18n/server-error";
import { deleteReview, saveReview } from "@/lib/reviews/functions";

import { createReviewReport } from "@/lib/reports/functions";
import type { ReportReason } from "@/lib/reports/reasons";

/**
 * Writing, editing, deleting, and reporting a novel's reviews.
 *
 * Every write invalidates all three review keys together: the summary moves when a rating
 * changes, the list moves when a review is removed, and "your review" moves with both.
 * Reporting only nudges the list, because it changes nothing but the viewer's own
 * `viewerReported` flag.
 */
export function useReviewMutations(novelId: string) {
  const t = useTranslations("reviews");
  // The report's two sentences belong to the surface that owns reporting, shared with a comment's
  // report and a novel's.
  const tReports = useTranslations("reports");
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const invalidateReviews = () => {
    void queryClient.invalidateQueries({ queryKey: ["novelRating", novelId] });
    void queryClient.invalidateQueries({ queryKey: ["novelReviews", novelId] });
    void queryClient.invalidateQueries({ queryKey: ["myReview", novelId] });
  };

  const save = useMutation({
    mutationFn: (input: { rating: number; body?: string }) =>
      saveReview({ data: { novelId, rating: input.rating, body: input.body } }),
    onSuccess: () => {
      toast.success(t("saved"));
      invalidateReviews();
    },
    onError: (error: unknown) => toast.error(translateServerError(error, tRoot, t("saveFailed"))),
  });

  const remove = useMutation({
    mutationFn: () => deleteReview({ data: { novelId } }),
    onSuccess: () => {
      toast.success(t("deleted"));
      invalidateReviews();
    },
    onError: (error: unknown) => toast.error(translateServerError(error, tRoot, t("deleteFailed"))),
  });

  const report = useMutation({
    mutationFn: (input: { reviewId: string; reason: ReportReason; details?: string }) =>
      createReviewReport({ data: input }),
    onSuccess: () => {
      toast.success(tReports("sent"));
      invalidateReviews();
    },
    onError: (error: unknown) =>
      toast.error(translateServerError(error, tRoot, tReports("failed"))),
  });

  return { save, remove, report };
}
