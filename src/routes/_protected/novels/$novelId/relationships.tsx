import { createFileRoute, redirect } from "@tanstack/react-router";

import { relationshipMapSearchSchema } from "@/lib/relationships/query";

/**
 * Kept as a redirect: the relationship map is a studio section now, and which tab and page
 * the viewer was on is part of the address, so it survives the move.
 */
export const Route = createFileRoute("/_protected/novels/$novelId/relationships")({
  validateSearch: relationshipMapSearchSchema,
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/novels/$novelId/manage/relationships",
      params,
      search: location.search,
      replace: true,
    });
  },
});
