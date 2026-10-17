import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { useLocale, useTranslations } from "use-intl";

import { LibraryEmpty } from "@/components/novels/library/library-empty";
import { LibraryNoMatches } from "@/components/novels/library/library-no-matches";
import { LibraryPending } from "@/components/novels/library/library-pending";
import { LibraryToolbar } from "@/components/novels/library/library-toolbar";
import {
  catalogQueryOptions,
  catalogTagsQueryOptions,
  type LibraryScope,
} from "@/components/novels/library/library-query";
import { toCatalogFilters, type LibrarySearch } from "@/components/novels/library/library-search";
import { NovelCard } from "@/components/novels/novel-card";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/locales";

interface LibraryPageProps {
  scope: LibraryScope;
  signedIn: boolean;
  search: LibrarySearch;
  onSearchChange: (patch: Partial<LibrarySearch>) => void;
}

/**
 * One component serves two surfaces: the shared catalog everyone can read, and the
 * signed-in shelf of novels the account owns.
 *
 * `scope` decides which one it is, and it is the only thing that decides whether
 * manage affordances appear — never the mere presence of a session, which used to make
 * a signed-in reader of someone else's novel look like its owner.
 *
 * The page requests one page of rows and the filtered total; the filters themselves are
 * the database's, so a catalog of thirty thousand novels answers the first page the same
 * way a catalog of thirty does. Search state and navigation arrive as props rather than
 * from a bound route, because this component is mounted by more than one route with its
 * own search schema.
 */
export function LibraryPage({ scope, signedIn, search, onSearchChange }: LibraryPageProps) {
  const t = useTranslations("catalog");
  const tCommon = useTranslations("common");
  const locale = useLocale() as Locale;
  const canManage = scope === "mine";

  const filters = useMemo(() => toCatalogFilters(search, locale), [locale, search]);
  const query = useInfiniteQuery(catalogQueryOptions(scope, filters));
  const tagsQuery = useQuery({ ...catalogTagsQueryOptions(), enabled: !canManage });

  const novels = useMemo(
    () => query.data?.pages.flatMap((page) => page.novels) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;
  const hasFilters =
    search.q !== "" ||
    search.language !== "all" ||
    search.tag !== "" ||
    (canManage && search.publication !== "all");

  if (query.isPending && novels.length === 0) return <LibraryPending />;

  const heading = canManage ? t("titleOwn") : t("title");
  const description = canManage
    ? t("descriptionOwn")
    : signedIn
      ? t("descriptionSignedIn")
      : t("descriptionGuest");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section text-foreground">{heading}</h1>
          <p className="mt-1.5 text-body text-muted-foreground">{description}</p>
        </div>
        {/* One call to action per state: with an empty shelf the empty state owns it. */}
        {canManage && total > 0 ? (
          <Button className="self-start sm:self-auto" render={<Link to="/novels/new" />}>
            <Plus className="size-4" aria-hidden="true" />
            {t("newNovel")}
          </Button>
        ) : null}
      </div>

      {query.isError ? (
        <ErrorState
          title={t("loadFailed")}
          error={query.error}
          onRetry={() => void query.refetch()}
          className="min-h-[45vh]"
        />
      ) : total === 0 ? (
        hasFilters ? (
          <LibraryNoMatches
            onClear={() => onSearchChange({ q: "", language: "all", publication: "all", tag: "" })}
          />
        ) : (
          <LibraryEmpty canManage={canManage} signedIn={signedIn} />
        )
      ) : (
        <>
          <LibraryToolbar
            search={search}
            tags={canManage ? [] : (tagsQuery.data ?? [])}
            isAdmin={canManage}
            resultCount={novels.length}
            totalCount={total}
            onSearchChange={onSearchChange}
          />
          {novels.length === 0 ? (
            <LibraryNoMatches
              onClear={() =>
                onSearchChange({ q: "", language: "all", publication: "all", tag: "" })
              }
            />
          ) : (
            <div
              className={
                search.view === "grid"
                  ? "grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4"
                  : "grid gap-3"
              }
            >
              {novels.map((novel, index) => (
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

          {query.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? tCommon("loading") : t("loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
