import { createFileRoute } from "@tanstack/react-router";

import { LibraryPage } from "@/components/novels/library-page";
import { LibraryPending } from "@/components/novels/library-pending";
import { novelsQueryOptions } from "@/components/novels/library-query";
import { librarySearchSchema } from "@/components/novels/library-search";

export const Route = createFileRoute("/_public/")({
  validateSearch: librarySearchSchema,
  loaderDeps: () => ({}),
  shouldReload: false,
  loader: async ({ context }) => ({
    novels: await context.queryClient.ensureQueryData(novelsQueryOptions),
  }),
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
  component: LibraryPage,
});
