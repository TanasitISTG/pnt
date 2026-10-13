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
 * The shared catalog: every published novel, readable by guests and by signed-in
 * readers alike. It replaces `/browse`, which `/browse` now redirects to, so the two
 * near-identical catalogs the app used to have are one page with one name.
 */
export const Route = createFileRoute("/_public/catalog")({
  validateSearch: librarySearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(novelsQueryOptions("public"));
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: LibraryPending,
  head: () => ({
    meta: [
      { title: "Catalog | Pnt - Personal Novel Translator" },
      {
        name: "description",
        content: "Browse published novel translations from the Pnt community.",
      },
    ],
  }),
  component: CatalogPage,
});

function CatalogPage() {
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
