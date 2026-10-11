import { useCallback } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";

import { LibraryPage } from "@/components/novels/library/library-page";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { novelsQueryOptions } from "@/components/novels/library/library-query";
import {
  librarySearchSchema,
  type LibrarySearch,
} from "@/components/novels/library/library-search";

/**
 * The shared catalog, for a signed-in account.
 *
 * `/` stays what it always was — the catalog for a guest and the workspace for a
 * signed-in account — so the sitemap and crawler view are unaffected. This route is
 * how a signed-in reader reaches everyone else's published novels, which previously
 * had no entry point at all.
 */
export const Route = createFileRoute("/_public/browse")({
  validateSearch: librarySearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context }) => ({
    novels: await context.queryClient.ensureQueryData(novelsQueryOptions("public")),
  }),
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: LibraryPending,
  head: () => ({
    meta: [
      { title: "Browse | Pnt - Personal Novel Translator" },
      {
        name: "description",
        content: "Browse published novel translations from the Pnt community.",
      },
    ],
  }),
  component: BrowsePage,
});

function BrowsePage() {
  // Root context for the same reason as the home route: a session change must be read
  // from the live root match, not from this route's creation-time snapshot.
  const { user } = useRouteContext({ from: "__root__" });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSearchChange = useCallback(
    (patch: Partial<LibrarySearch>) => {
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return (
    <LibraryPage
      scope="public"
      signedIn={Boolean(user)}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}
