import { getRouteApi, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useCallback, useMemo } from "react";

import { LibraryEmpty } from "@/components/novels/library-empty";
import { LibraryNoMatches } from "@/components/novels/library-no-matches";
import { LibraryPending } from "@/components/novels/library-pending";
import { LibraryToolbar } from "@/components/novels/library-toolbar";
import { novelsQueryOptions } from "@/components/novels/library-query";
import { NovelCard } from "@/components/novels/novel-card";
import { selectLibraryNovels, type LibrarySearch } from "@/components/novels/library-search";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";

const libraryRoute = getRouteApi("/_public/");

export function LibraryPage() {
  const { user } = libraryRoute.useRouteContext();
  const search = libraryRoute.useSearch();
  const navigate = libraryRoute.useNavigate();
  const { data: novels = [], isPending, isError, error, refetch } = useQuery(novelsQueryOptions);
  const isAdmin = Boolean(user);
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
  const languages = useMemo(
    () =>
      Array.from(new Set(novels.map((novel) => `${novel.sourceLang}->${novel.targetLang}`))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [novels],
  );
  const selectedNovels = useMemo(
    () => selectLibraryNovels(novels, search, isAdmin),
    [isAdmin, novels, search],
  );

  if (isPending && novels.length === 0) return <LibraryPending />;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-sub font-semibold tracking-tight text-foreground sm:text-section">
            {user ? "Your Library" : "Library"}
          </h1>
          <p className="mt-1 text-body text-muted-foreground">
            {user
              ? "Find a project, resume reading, or continue translating."
              : "Browse the translated novel collection."}
          </p>
        </div>
        {user && (
          <Button className="self-start sm:self-auto" render={<Link to="/novels/new" />}>
            <Plus className="size-4" aria-hidden="true" />
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
        <LibraryEmpty isAdmin={isAdmin} />
      ) : (
        <>
          <LibraryToolbar
            key={search.q}
            search={search}
            languages={languages}
            isAdmin={isAdmin}
            resultCount={selectedNovels.length}
            totalCount={novels.length}
            onSearchChange={onSearchChange}
          />
          {selectedNovels.length === 0 ? (
            <LibraryNoMatches
              onClear={() =>
                onSearchChange({
                  q: "",
                  language: "all",
                  publication: "all",
                })
              }
            />
          ) : (
            <div
              className={
                search.view === "grid"
                  ? "grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4"
                  : "grid gap-3"
              }
            >
              {selectedNovels.map((novel, index) => (
                <NovelCard
                  key={novel.id}
                  novel={novel}
                  view={search.view}
                  isAdmin={isAdmin}
                  lazyCover={index > 0}
                  priorityCover={index === 0}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
