import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { LibraryEmpty } from "@/components/novels/library/library-empty";
import { LibraryNoMatches } from "@/components/novels/library/library-no-matches";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { LibraryToolbar } from "@/components/novels/library/library-toolbar";
import { novelsQueryOptions, type LibraryScope } from "@/components/novels/library/library-query";
import { NovelCard } from "@/components/novels/novel-card";
import {
  selectLibraryNovels,
  type LibrarySearch,
} from "@/components/novels/library/library-search";
import { QueryErrorState } from "@/components/query-error-state";
import { Button } from "@/components/ui/button";

interface LibraryPageProps {
  scope: LibraryScope;
  signedIn: boolean;
  search: LibrarySearch;
  onSearchChange: (patch: Partial<LibrarySearch>) => void;
}

/**
 * One component serves three surfaces: a guest's public catalog, a signed-in
 * account's workspace, and the shared catalog a signed-in account browses.
 *
 * `scope` decides which of those it is, and it is the only thing that decides whether
 * manage affordances appear — never the mere presence of a session, which used to make
 * a signed-in reader of someone else's novel look like its owner.
 *
 * Search state and navigation arrive as props rather than from a bound route, because
 * this component is mounted by two routes with their own search schemas.
 */
export function LibraryPage({ scope, signedIn, search, onSearchChange }: LibraryPageProps) {
  const {
    data: novels = [],
    isPending,
    isError,
    error,
    refetch,
  } = useQuery(novelsQueryOptions(scope));
  const canManage = scope === "mine";
  const languages = useMemo(
    () =>
      Array.from(
        new Set(novels.map((novel) => `${novel.sourceLang}->${novel.targetLang}`)),
      ).toSorted((a, b) => a.localeCompare(b)),
    [novels],
  );
  const selectedNovels = useMemo(
    () => selectLibraryNovels(novels, search, canManage),
    [canManage, novels, search],
  );

  if (isPending && novels.length === 0) return <LibraryPending />;

  const heading = canManage ? "Your Library" : signedIn ? "Browse" : "Library";
  const description = canManage
    ? "Find a project, resume reading, or continue translating."
    : signedIn
      ? "Published novels from everyone on Pnt."
      : "Browse the translated novel collection.";

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-sub font-semibold tracking-tight text-foreground sm:text-section">
            {heading}
          </h1>
          <p className="mt-1 text-body text-muted-foreground">{description}</p>
        </div>
        {canManage && (
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
        <LibraryEmpty canManage={canManage} signedIn={signedIn} />
      ) : (
        <>
          <LibraryToolbar
            search={search}
            languages={languages}
            isAdmin={canManage}
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
                  isAdmin={canManage}
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
