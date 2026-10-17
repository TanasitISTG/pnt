import { useCallback } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";

import { LibraryPage } from "@/components/novels/library/library-page";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { prefetchCatalogFirstPage } from "@/components/novels/library/library-query";
import {
  librarySearchSchema,
  toCatalogFilters,
  type LibrarySearch,
} from "@/components/novels/library/library-search";
import { headTranslator } from "@/lib/i18n/route-head";

/**
 * The shared catalog: every published novel, readable by guests and by signed-in
 * readers alike. It replaces `/browse`, which `/browse` now redirects to, so the two
 * near-identical catalogs the app used to have are one page with one name.
 */
export const Route = createFileRoute("/{-$locale}/_public/catalog")({
  validateSearch: librarySearchSchema,
  // The search *is* the request now, so a shared URL carries its own results and the
  // server render answers the page the reader asked for instead of the whole table.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await prefetchCatalogFirstPage(
      context.queryClient,
      "public",
      toCatalogFilters(deps, context.locale),
    );
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: LibraryPending,
  head: async () => {
    const t = await headTranslator();
    return {
      meta: [
        { title: `${t("meta.catalog")} | ${t("meta.siteName")}` },
        { name: "description", content: t("meta.catalogDescription") },
      ],
    };
  },
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
