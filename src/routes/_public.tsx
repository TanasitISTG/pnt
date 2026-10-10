import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  const { user } = Route.useRouteContext();
  const isReader = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => match.routeId === "/_public/novels/$novelId/chapters/$chapterId",
      ),
  });

  return (
    <AppShell user={user} layout={isReader ? "reader" : "default"}>
      <Outlet />
    </AppShell>
  );
}
