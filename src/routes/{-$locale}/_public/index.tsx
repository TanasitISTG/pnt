import { useCallback } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";

import { ReadingHome } from "@/components/home/reading-home";
import { LibraryPage } from "@/components/novels/library/library-page";
import { LibraryPending } from "@/components/novels/library/library-pending";
import {
  novelsQueryOptions,
  prefetchCatalogFirstPage,
} from "@/components/novels/library/library-query";
import {
  librarySearchSchema,
  toCatalogFilters,
  type LibrarySearch,
} from "@/components/novels/library/library-search";
import { headTranslator } from "@/lib/i18n/route-head";

/**
 * Home. A guest gets the shared catalog — which is also what the sitemap and crawlers
 * see — while a signed-in account lands on its reading home: continue reading, your
 * novels, and whether anything is running.
 *
 * Browsing other people's published novels is `/catalog`, and the account's own shelf is
 * `/library`; `/` used to be both of those at once, which is why a returning reader had
 * nowhere to resume.
 */
export const Route = createFileRoute("/{-$locale}/_public/")({
  validateSearch: librarySearchSchema,
  loaderDeps: ({ search }) => search,
  shouldReload: false,
  loader: async ({ context, deps }) => {
    // A guest's home is the catalog itself, so it prefetches the same first page the
    // catalog does, filters and all. A signed-in account's home is the reading home, which
    // reads only the first page of its own shelf.
    if (context.user) {
      await context.queryClient.ensureQueryData(novelsQueryOptions("mine", context.locale));
      return;
    }
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
        { title: t("meta.siteName") },
        { name: "description", content: t("meta.homeDescription") },
      ],
    };
  },
  component: HomeRoute,
});

function HomeRoute() {
  // The viewer comes from the root match, never this route's own snapshot: signing out
  // while already on `/` invalidates the router, which refreshes the root context (the
  // shell switches to "Sign in") while this route's match keeps the context it was
  // created with.
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

  if (user) return <ReadingHome user={user} />;

  return (
    <LibraryPage scope="public" signedIn={false} search={search} onSearchChange={onSearchChange} />
  );
}
