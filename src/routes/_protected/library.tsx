import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { LibraryPage } from "@/components/novels/library/library-page";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { novelsQueryOptions } from "@/components/novels/library/library-query";
import {
  librarySearchSchema,
  type LibrarySearch,
} from "@/components/novels/library/library-search";

/**
 * The account's own shelf. It used to be what `/` showed a signed-in user, which meant
 * the front door was a management screen; it is now its own destination with its own
 * name, and `/` is the reading home.
 *
 * Protected rather than public: a guest has no novels, and the route gate says so before
 * the query would fail.
 */
export const Route = createFileRoute("/_protected/library")({
  validateSearch: librarySearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(novelsQueryOptions("mine"));
  },
  pendingMs: 100,
  pendingMinMs: 200,
  pendingComponent: LibraryPending,
  head: () => ({
    meta: [{ title: "Your Library | Pnt - Personal Novel Translator" }],
  }),
  component: LibraryRoute,
});

function LibraryRoute() {
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

  return <LibraryPage scope="mine" signedIn search={search} onSearchChange={onSearchChange} />;
}
