import { createFileRoute } from "@tanstack/react-router";

import { StudioSettingsPage } from "@/components/studio/studio-settings-page";

export const Route = createFileRoute("/_protected/novels/$novelId/manage/settings")({
  component: StudioSettingsRoute,
});

function StudioSettingsRoute() {
  const { novelId } = Route.useParams();

  return <StudioSettingsPage novelId={novelId} />;
}
