import { createFileRoute } from "@tanstack/react-router";

import { StudioAddPage } from "@/components/studio/studio-add-page";

export const Route = createFileRoute("/_protected/novels/$novelId/manage/add")({
  component: StudioAddRoute,
});

function StudioAddRoute() {
  const { novelId } = Route.useParams();

  return <StudioAddPage novelId={novelId} />;
}
