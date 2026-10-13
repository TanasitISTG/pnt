import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { TranslationQualityPanel } from "@/components/translation/evaluation/translation-quality-panel";
import {
  evalReviewSearchSchema,
  type EvalReviewSearch,
} from "@/lib/translation/evaluation/eval.schemas";

export const Route = createFileRoute("/_protected/novels/$novelId/manage/quality")({
  validateSearch: evalReviewSearchSchema,
  component: StudioQualityRoute,
});

/**
 * The quality checks and their reports are an owner's tool, so the review state that used to
 * ride on the public novel URL rides on this one: `reviewReport` is what the admin report
 * queue links to, and it stays a shareable, reloadable address.
 */
function StudioQualityRoute() {
  const { novelId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const onReviewSearchChange = useCallback(
    (patch: Partial<EvalReviewSearch>) => {
      void navigate({
        to: "/novels/$novelId/manage/quality",
        params: { novelId },
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate, novelId],
  );

  return (
    <TranslationQualityPanel
      novelId={novelId}
      reviewSearch={search}
      onReviewSearchChange={onReviewSearchChange}
    />
  );
}
