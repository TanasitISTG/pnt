import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";

import { listNovels } from "@/lib/novel.functions";
import { NovelCard } from "@/components/novel-card";
import { Button } from "@/components/ui/button";

const novelsQueryOptions = queryOptions({
  queryKey: ["novels"],
  queryFn: () => listNovels(),
});

export const Route = createFileRoute("/_protected/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(novelsQueryOptions),
  component: LibraryPage,
});

function LibraryPage() {
  const { data: novels = [] } = useQuery(novelsQueryOptions);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-sub sm:text-section font-semibold text-foreground tracking-tight">
            Your Library
          </h1>
          <p className="text-body text-muted-foreground mt-1">
            Manage and translate your web novel collection.
          </p>
        </div>
        {novels.length > 0 && (
          <Button className="self-start sm:self-auto" render={<Link to="/novels/new" />}>
            <Plus className="size-4" />
            New Novel
          </Button>
        )}
      </div>

      {novels.length === 0 ? (
        <div className="flex min-h-[45vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <BookOpen className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-card-title font-semibold text-foreground">No novels yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Create a novel project to start pasting chapters and translating them.
          </p>
          <div className="mt-6">
            <Button render={<Link to="/novels/new" />}>
              <Plus className="size-4" />
              New Novel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {novels.map((novel) => (
            <NovelCard key={novel.id} novel={novel} />
          ))}
        </div>
      )}
    </div>
  );
}
