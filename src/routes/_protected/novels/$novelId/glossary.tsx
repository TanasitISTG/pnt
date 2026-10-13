import { createFileRoute, redirect } from "@tanstack/react-router";

import { glossaryListSearchSchema } from "@/lib/glossary/schemas";

/**
 * Kept as a redirect: the glossary is a studio section now, and its list state travels with
 * the link, so a bookmark to a filtered page lands on the same filtered page.
 */
export const Route = createFileRoute("/_protected/novels/$novelId/glossary")({
  validateSearch: glossaryListSearchSchema,
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: "/novels/$novelId/manage/glossary",
      params,
      search: location.search,
      replace: true,
    });
  },
});
