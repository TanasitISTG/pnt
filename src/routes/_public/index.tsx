import { useCallback } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";

import { LibraryPage } from "@/components/novels/library/library-page";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { novelsQueryOptions, type LibraryScope } from "@/components/novels/library/library-query";
import {
  librarySearchSchema,
  type LibrarySearch,
} from "@/components/novels/library/library-search";

/**
 * Home. A guest gets the shared public catalog — which is also what the sitemap and
 * crawlers see — while a signed-in account lands on its own workspace. Browsing other
 * people's published novels is `/browse`.
 */
export const Route = createFileRoute("/_public/")({
  validateSearch: librarySearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context }) => {
    const scope: LibraryScope = context.user ? "mine" : "public";
    await context.queryClient.ensureQueryData(novelsQueryOptions(scope));
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: LibraryPending,
  head: () => ({
    meta: [
      {
        title: "Library | Pnt - Personal Novel Translator",
      },
      {
        name: "description",
        content: "Browse the translated web novel collection.",
      },
    ],
  }),
  component: HomeLibraryPage,
});

function HomeLibraryPage() {
  // The viewer comes from the root match, never this route's own snapshot: signing out
  // while already on `/` invalidates the router, which refreshes the root context (the
  // shell switches to "Sign in") while this route's match keeps the context it was
  // created with. Reading it here is what makes the catalog follow the live session
  // rather than showing the previous account's workspace to a guest.
  const { user } = useRouteContext({ from: "__root__" });
  const scope: LibraryScope = user ? "mine" : "public";
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
      scope={scope}
      signedIn={Boolean(user)}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}
