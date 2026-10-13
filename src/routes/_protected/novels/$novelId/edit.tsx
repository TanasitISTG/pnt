import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Kept as a redirect: the editing screen is a studio section now, but a bookmark or a
 * shared link to it should still land on the form rather than a 404.
 */
export const Route = createFileRoute("/_protected/novels/$novelId/edit")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/novels/$novelId/manage/settings",
      params,
      replace: true,
    });
  },
});
