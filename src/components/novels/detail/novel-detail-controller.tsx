import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { QueryErrorState } from "@/components/query-error-state";
import { useNovelDetailPage } from "@/components/novels/detail/use-novel-detail-page";
import { NovelDetailDialogs } from "@/components/novels/detail/novel-detail-dialogs";
import { NovelDetailSections } from "@/components/novels/detail/novel-detail-sections";
import type {
  DetailSection,
  NovelDetailSearch,
} from "@/components/novels/detail/novel-detail-search";

export interface NovelDetailControllerProps {
  novelId: string;
  isAdmin: boolean;
  reviewSearch: NovelDetailSearch;
  onReviewSearchChange: (patch: Partial<NovelDetailSearch>) => void;
}

export function NovelDetailController({
  novelId,
  isAdmin,
  reviewSearch,
  onReviewSearchChange,
}: NovelDetailControllerProps) {
  const { loadState, sectionProps, tableProps, dialogProps } = useNovelDetailPage(novelId, isAdmin);
  const [addVisited, setAddVisited] = useState(reviewSearch.section === "add");
  const titleEditing = tableProps.titleEdit !== null;
  const requestedSection: DetailSection = reviewSearch.reviewReport
    ? "quality"
    : (reviewSearch.section ?? "chapters");
  const section: DetailSection = isAdmin ? requestedSection : "chapters";

  const setSection = useCallback(
    (nextSection: string) => {
      if (titleEditing) {
        toast.info("Finish saving or canceling the chapter title edit first.");
        return;
      }
      if (nextSection === "chapters" || nextSection === "add" || nextSection === "quality") {
        if (nextSection === "add") setAddVisited(true);
        onReviewSearchChange({ section: nextSection });
      }
    },
    [onReviewSearchChange, titleEditing],
  );

  if (loadState.isNovelError || loadState.isChaptersError) {
    return (
      <QueryErrorState
        title="Failed to load novel"
        error={loadState.novelError || loadState.chaptersError}
        onRetry={() => {
          loadState.refetchNovel();
          loadState.refetchChapters();
        }}
        className="my-12 min-h-[40vh]"
      />
    );
  }

  const novel = loadState.novel;
  if (!novel) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-card-title font-semibold text-foreground">Novel not found</h2>
        <p className="mt-2 text-muted-foreground">The novel you are looking for does not exist.</p>
        <Button className="mt-4" render={<Link to="/" />}>
          Back to Library
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <NovelDetailSections
        novel={novel}
        novelId={novelId}
        isAdmin={isAdmin}
        section={section}
        addVisited={addVisited}
        reviewSearch={reviewSearch}
        detail={sectionProps}
        tableProps={tableProps}
        onSectionChange={setSection}
        onReviewSearchChange={onReviewSearchChange}
      />
      <NovelDetailDialogs detail={dialogProps} />
    </div>
  );
}
