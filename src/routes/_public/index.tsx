import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";

import { listNovels } from "@/lib/novel.functions";
import { NovelCard } from "@/components/novel-card";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";

const novelsQueryOptions = queryOptions({
  queryKey: ["novels"],
  queryFn: () => listNovels(),
});

export const Route = createFileRoute("/_public/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(novelsQueryOptions),
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

function LibraryPage() {
  const { user } = Route.useRouteContext();
  const { data: novels = [], isError, error, refetch } = useQuery(novelsQueryOptions);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-sub sm:text-section font-semibold text-foreground tracking-tight">
            {user ? "Your Library" : "Library"}
          </h1>
          <p className="text-body text-muted-foreground mt-1">
            {user
              ? "Manage and translate your web novel collection."
              : "Browse the translated novel collection."}
          </p>
        </div>
        {user && novels.length > 0 && (
          <Button className="self-start sm:self-auto" render={<Link to="/novels/new" />}>
            <Plus className="size-4" />
            New Novel
          </Button>
        )}
      </div>

      {isError ? (
        <QueryErrorState
          title="Failed to load library"
          error={error}
          onRetry={() => refetch()}
          className="min-h-[45vh]"
        />
      ) : novels.length === 0 ? (
        <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <BookOpen className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-card-title font-semibold text-foreground">
            {user ? "No novels yet" : "Nothing published yet"}
          </h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {user
              ? "Create a novel project to start pasting chapters and translating them."
              : "Check back later — published novels will appear here."}
          </p>
          {user && (
            <div className="mt-6">
              <Button render={<Link to="/novels/new" />}>
                <Plus className="size-4" />
                New Novel
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {novels.map((novel) => (
            <NovelCard key={novel.id} novel={novel} showPublishState={!!user} />
          ))}
        </div>
      )}
    </div>
  );
}
