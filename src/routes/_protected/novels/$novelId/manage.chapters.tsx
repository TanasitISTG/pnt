import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { StudioChaptersPage } from "@/components/studio/studio-chapters-page";
import { chapterWorkspaceSearchSchema } from "@/components/studio/studio-search";

export const Route = createFileRoute("/_protected/novels/$novelId/manage/chapters")({
  validateSearch: chapterWorkspaceSearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  component: StudioChaptersRoute,
});

function StudioChaptersRoute() {
  const { novelId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const onChapterQueryChange = useCallback(
    (chapterQuery: string) => {
      void navigate({
        to: "/novels/$novelId/manage/chapters",
        params: { novelId },
        search: (previous) => ({ ...previous, chapterQuery: chapterQuery || undefined }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate, novelId],
  );

  return (
    <StudioChaptersPage
      novelId={novelId}
      chapterQuery={search.chapterQuery ?? ""}
      onChapterQueryChange={onChapterQueryChange}
      onAddChapters={() => {
        void navigate({ to: "/novels/$novelId/manage/add", params: { novelId } });
      }}
    />
  );
}
