import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The studio opens on the chapter workspace: it is the section the others feed, and a bare
 * `/manage` should never be a dead end or an empty page of tabs.
 */
export const Route = createFileRoute("/_protected/novels/$novelId/manage/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/novels/$novelId/manage/chapters", params });
  },
});
