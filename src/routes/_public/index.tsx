import { useCallback } from "react";
import { createFileRoute, useRouteContext } from "@tanstack/react-router";

import { ReadingHome } from "@/components/home/reading-home";
import { LibraryPage } from "@/components/novels/library/library-page";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { novelsQueryOptions, type LibraryScope } from "@/components/novels/library/library-query";
import {
  librarySearchSchema,
  type LibrarySearch,
} from "@/components/novels/library/library-search";

/**
 * Home. A guest gets the shared catalog — which is also what the sitemap and crawlers
 * see — while a signed-in account lands on its reading home: continue reading, your
 * novels, and whether anything is running.
 *
 * Browsing other people's published novels is `/catalog`, and the account's own shelf is
 * `/library`; `/` used to be both of those at once, which is why a returning reader had
 * nowhere to resume.
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
        title: "Pnt - Personal Novel Translator",
      },
      {
        name: "description",
        content:
          "Translate and read web novels side by side, with a glossary that keeps terms consistent.",
      },
    ],
  }),
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
